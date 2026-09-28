let count = 0;
declare const self: Worker;
self.onmessage = (event: MessageEvent<{ text: string }>) => {
  if (event.data.text === 'hang') return;
  if (event.data.text === 'error') return self.postMessage({ error: 'fixture failed' });
  self.postMessage({ vector: [++count, event.data.text.length] });
};

export {};
