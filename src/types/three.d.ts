declare global {
  interface HTMLCanvasElement {
    userData: {
      canvas?: HTMLCanvasElement;
      camera?: THREE.PerspectiveCamera;
    };
  }
}