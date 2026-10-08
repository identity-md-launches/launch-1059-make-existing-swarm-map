interface Window {
  // Existing vendored ethers UMD boundary; no runtime dependency is added.
  ethers: any;
  __swarm: any;
}
interface SwarmElements {
  [id: string]: HTMLElement;
  c: HTMLCanvasElement;
  hlAddr: HTMLInputElement;
  calcLevel: HTMLSelectElement;
  calcFrom: HTMLSelectElement;
  calcAccount: HTMLInputElement;
  alertScope: HTMLSelectElement;
  alertIds: HTMLInputElement;
  alertThreshold: HTMLInputElement;
  alertEnabled: HTMLInputElement;
  alertAuction: HTMLInputElement;
  alertActivation: HTMLInputElement;
  alertExit: HTMLInputElement;
  alertSwap: HTMLInputElement;
  alertSound: HTMLInputElement;
  enableNotifications: HTMLButtonElement;
}
