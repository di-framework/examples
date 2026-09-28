// A standard-operator synthetic ONNX fixture for the embedding smoke check.
use onnx_rs::ast::*;
fn info(name: &'static str, kind: DataType, dims: Vec<Dimension<'static>>) -> ValueInfo<'static> {
    ValueInfo { name, r#type: Some(TypeProto {
        value: Some(TypeValue::Tensor(TensorTypeProto { elem_type: kind,
            shape: Some(TensorShape { dim: dims.into_iter().map(|value| TensorShapeDimension { value, denotation: "" }).collect() }),
        })), denotation: "",
    }), ..Default::default() }
}
fn main() {
    let model = Model { ir_version: 9, opset_import: vec![OperatorSetId { domain: "", version: 17 }],
        graph: Some(Graph { name: "smoke_embedding",
            node: vec![Node { op_type: OpType::Gather, input: vec!["E", "input_ids"], output: vec!["embedding"], ..Default::default() }],
            initializer: vec![TensorProto::from_f32("E", vec![64, 4], (0..256).map(|i| ((i as f32 + 1.0) * 1.2345).sin()).collect::<Vec<_>>())],
            input: vec![info("input_ids", DataType::Int64, vec![Dimension::Param("N"), Dimension::Value(2)])],
            output: vec![info("embedding", DataType::Float, vec![Dimension::Param("N"), Dimension::Value(2), Dimension::Value(4)])],
            ..Default::default()
        }), ..Default::default()
    };
    std::fs::write(std::env::args().nth(1).expect("output path"), onnx_rs::encode(&model)).unwrap();
}
