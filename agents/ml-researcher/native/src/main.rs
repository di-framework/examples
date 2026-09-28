use std::{fs, io::{self, Read}, path::Path};
use onnx_rs::ast::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    action: String,
    path: String,
    #[serde(default)] input_size: usize,
    #[serde(default)] output_size: usize,
    #[serde(default)] hidden: Vec<usize>,
    #[serde(default)] seed: u32,
    #[serde(default = "input_name")] input_name: String,
    #[serde(default = "output_name")] output_name: String,
}
fn input_name() -> String { "input".into() }
fn output_name() -> String { "output".into() }
fn value_info(name: &str, size: usize) -> ValueInfo<'_> {
    ValueInfo { name, r#type: Some(TypeProto {
        value: Some(TypeValue::Tensor(TensorTypeProto {
            elem_type: DataType::Float,
            shape: Some(TensorShape { dim: vec![
                TensorShapeDimension { value: Dimension::Param("N"), denotation: "" },
                TensorShapeDimension { value: Dimension::Value(size as i64), denotation: "" },
            ] }),
        })), denotation: "",
    }), ..Default::default() }
}
fn build(r: &Request) -> Result<(), Box<dyn std::error::Error>> {
    let sizes: Vec<usize> = std::iter::once(r.input_size).chain(r.hidden.iter().copied()).chain(std::iter::once(r.output_size)).collect();
    if r.hidden.len() > 4 || sizes.iter().any(|n| *n == 0 || *n > 1024) || sizes.windows(2).map(|s| (s[0]+1)*s[1]).sum::<usize>() > 1_000_000 {
        return Err("MLP dimensions exceed template limits".into());
    }
    let count = sizes.len()-1;
    let weights: Vec<String> = (0..count).map(|i| format!("W{i}")).collect();
    let biases: Vec<String> = (0..count).map(|i| format!("B{i}")).collect();
    let affine: Vec<String> = (0..count).map(|i| if i+1 == count { r.output_name.clone() } else { format!("affine{i}") }).collect();
    let activated: Vec<String> = (0..count).map(|i| format!("hidden{i}")).collect();
    let mut nodes = Vec::new();
    let mut initializers = Vec::new();
    let mut seed = r.seed as u64 + 1;
    for i in 0..count {
        let fan_in = sizes[i]; let fan_out = sizes[i+1];
        let bound = (6.0 / (fan_in + fan_out) as f32).sqrt();
        let values = (0..fan_in*fan_out).map(|_| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            (((seed >> 32) as u32 as f64 / u32::MAX as f64) as f32 * 2.0 - 1.0) * bound
        }).collect::<Vec<_>>();
        initializers.push(TensorProto::from_f32(&weights[i], vec![fan_in as i64, fan_out as i64], values));
        initializers.push(TensorProto::from_f32(&biases[i], vec![fan_out as i64], vec![0.0; fan_out]));
        nodes.push(Node { name: &affine[i], op_type: OpType::Gemm,
            input: vec![if i == 0 { &r.input_name } else { &activated[i-1] }, &weights[i], &biases[i]],
            output: vec![&affine[i]], ..Default::default() });
        if i+1 != count {
            nodes.push(Node { name: &activated[i], op_type: OpType::Relu, input: vec![&affine[i]], output: vec![&activated[i]], ..Default::default() });
        }
    }
    let model = Model { ir_version: 9, producer_name: "ml-researcher", producer_version: "0.1.0",
        opset_import: vec![OperatorSetId { domain: "", version: 17 }],
        graph: Some(Graph { name: "dense_mlp", node: nodes, initializer: initializers,
            input: vec![value_info(&r.input_name, r.input_size)], output: vec![value_info(&r.output_name, r.output_size)], ..Default::default() }), ..Default::default() };
    fs::write(&r.path, onnx_rs::encode(&model))?;
    Ok(())
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut input = String::new(); io::stdin().read_to_string(&mut input)?;
    let request: Request = serde_json::from_str(&input)?;
    match request.action.as_str() {
        "build" => { build(&request)?; println!("{{\"built\":true}}"); },
        "inspect" => {
            let graph = di_ml::ExecGraph::load(fs::read(&request.path)?)?;
            if graph.weight_names.is_empty() { return Err("model has no trainable f32 initializers".into()); }
            println!("{}", serde_json::json!({ "inputs": graph.inputs, "outputs": graph.outputs, "weights": graph.weight_names, "ops": graph.nodes.len() }));
        },
        "train" => {
            let result = di_ml::run_workspace(Path::new(&request.path))?;
            println!("{}", serde_json::json!({ "model": result.dist_model, "metrics": result.dist_metrics }));
        },
        _ => return Err("unknown action".into()),
    }
    Ok(())
}
