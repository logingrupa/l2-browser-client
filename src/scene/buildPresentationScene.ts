import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PresentationConfiguration } from "./presentationConfiguration";

function createWorldCamera(scene: Scene, configuration: PresentationConfiguration["camera"]): ArcRotateCamera {
  const camera = new ArcRotateCamera(configuration.name, configuration.alpha, configuration.beta, configuration.radius,
    Vector3.FromArray(configuration.target), scene);
  camera.minZ = configuration.minZ;
  camera.maxZ = configuration.maxZ;
  camera.fov = configuration.fov;
  camera.fovMode = configuration.fovMode;
  camera.lowerRadiusLimit = configuration.lowerRadiusLimit;
  camera.upperRadiusLimit = configuration.upperRadiusLimit;
  camera.lowerBetaLimit = configuration.lowerBetaLimit;
  camera.upperBetaLimit = configuration.upperBetaLimit;
  camera.inertia = configuration.inertia;
  camera.panningInertia = configuration.panningInertia;
  camera.speed = configuration.speed;
  camera.pinchToPanMaxDistance = configuration.pinchToPanMaxDistance;
  camera.allowUpsideDown = configuration.allowUpsideDown;
  return camera;
}

function createLights(scene: Scene, configuration: PresentationConfiguration["lights"]): void {
  const skyLight = new HemisphericLight(configuration.sky.name, Vector3.FromArray(configuration.sky.direction), scene);
  skyLight.intensity = configuration.sky.intensity;
  skyLight.diffuse = Color3.FromArray(configuration.sky.diffuse);
  skyLight.specular = Color3.FromArray(configuration.sky.specular);
  skyLight.groundColor = Color3.FromArray(configuration.sky.groundColor);
  const sunlight = new DirectionalLight(configuration.sun.name, Vector3.FromArray(configuration.sun.direction), scene);
  sunlight.intensity = configuration.sun.intensity;
  sunlight.position = Vector3.FromArray(configuration.sun.position);
  sunlight.diffuse = Color3.FromArray(configuration.sun.diffuse);
  sunlight.specular = Color3.FromArray(configuration.sun.specular);
}

export function buildPresentationScene(engine: AbstractEngine, configuration: PresentationConfiguration): { scene: Scene; camera: ArcRotateCamera } {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = createWorldCamera(scene, configuration.camera);
  scene.activeCamera = camera;
  createLights(scene, configuration.lights);
  scene.clearColor = Color4.FromArray(configuration.clearColor);
  scene.ambientColor = Color3.FromArray(configuration.ambientColor);
  scene.fogEnabled = configuration.fog.enabled;
  scene.fogMode = configuration.fog.mode;
  scene.fogStart = configuration.fog.start;
  scene.fogEnd = configuration.fog.end;
  scene.fogDensity = configuration.fog.density;
  scene.fogColor = Color3.FromArray(configuration.fog.color);
  return { scene, camera };
}
