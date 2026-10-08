interface Window {
  // Existing vendored ethers UMD boundary; no runtime dependency is added.
  ethers: any;
  __swarm: any;
}
interface SwarmElements {
  [id: string]: HTMLElement;
  c: HTMLCanvasElement;
  hlAddr: HTMLInputElement;
}
