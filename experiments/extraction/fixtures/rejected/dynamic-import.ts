export async function load(name: string): Promise<void> {
  await import(name);
}
