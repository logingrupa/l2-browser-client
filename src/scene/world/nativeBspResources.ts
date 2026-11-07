/** Explicitly qualified saved BSP fragments; this does not enable arbitrary BSP. */
export const nativeBspResources: Readonly<Record<string, { brush: string; stem: string; placement: string }>> = {
  "interlude:20_20.Model798.Brush397": { brush: "20_20.Brush397", stem: "bsp-floor", placement: "interlude:20_20.StaticMeshActor940" },
  ...Object.fromEntries(["walls", "floor", "ceiling"].map(part => [
    `interlude:20_20.Model798.Brush610.${part}`,
    { brush: "20_20.Brush610", stem: `bsp-command-${part}`, placement: "interlude:20_20.StaticMeshActor1913" },
  ])),
};
