import "@fontsource-variable/cormorant-garamond/wght.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Effect } from "@babylonjs/core/Materials/effect";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import { attachAssetImport } from "../../src/ui/AssetImportPanel";

const canvas = document.getElementById("world-canvas") as HTMLCanvasElement;
const baselineMatrix = Effect.prototype.setMatrix;
const engine = new Engine(canvas, true, { useLargeWorldRendering: true }), scene = new Scene(engine);
const camera = new ArcRotateCamera("World camera", -.8, 1.2, 8, new Vector3(4500, -70, 1600), scene); camera.attachControl(canvas, true);
new HemisphericLight("Light", new Vector3(0, 1, 0), scene);
const mesh = MeshBuilder.CreateBox("World marker", {}, scene); mesh.position.set(4500, -70, 1600);
let paused = false;
attachAssetImport(scene, canvas, { host: document.getElementById("toolbar")!, onOpenChange: value => { paused = value; } });
engine.runRenderLoop(() => { if (!paused) scene.render(); });
window.addEventListener("resize", () => engine.resize());
window.__assetHarness = () => ({ engines: EngineStore.Instances.length, precision: Effect.prototype.setMatrix !== baselineMatrix, worldDisposed: scene.isDisposed, paused });
declare global { interface Window { __assetHarness?: () => { engines: number; precision: boolean; worldDisposed: boolean; paused: boolean } } }
