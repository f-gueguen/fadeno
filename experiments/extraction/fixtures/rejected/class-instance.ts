class Counter {
  value = 0;
}

const counter = new Counter();
export function increment(): void {
  counter.value += 1;
}
