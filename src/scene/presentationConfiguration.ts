export type Vector3Tuple = readonly [number, number, number];
export type ColorRgbTuple = readonly [number, number, number];
export type ColorRgbaTuple = readonly [number, number, number, number];

export const formerlyEditorAuthoredStatusLabel = "presentation, formerly Editor-authored, not L2";

export interface PresentationCameraConfiguration {
  name: "World camera";
  alpha: number;
  beta: number;
  radius: number;
  target: Vector3Tuple;
  minZ: number;
  maxZ: number;
  fov: number;
  fovMode: number;
  lowerRadiusLimit: number;
  upperRadiusLimit: number;
  lowerBetaLimit: number;
  upperBetaLimit: number;
  inertia: number;
  panningInertia: number;
  speed: number;
  pinchToPanMaxDistance: number;
  allowUpsideDown: boolean;
}

export interface HemisphericLightConfiguration {
  name: "Sky light";
  intensity: number;
  direction: Vector3Tuple;
  diffuse: ColorRgbTuple;
  specular: ColorRgbTuple;
  groundColor: ColorRgbTuple;
}

export interface DirectionalLightConfiguration {
  name: "Sunlight";
  intensity: number;
  direction: Vector3Tuple;
  position: Vector3Tuple;
  diffuse: ColorRgbTuple;
  specular: ColorRgbTuple;
}

export interface FogConfiguration {
  enabled: boolean;
  mode: number;
  start: number;
  end: number;
  density: number;
  color: ColorRgbTuple;
}

export interface PresentationConfiguration {
  camera: PresentationCameraConfiguration;
  lights: { sky: HemisphericLightConfiguration; sun: DirectionalLightConfiguration };
  clearColor: ColorRgbaTuple;
  ambientColor: ColorRgbTuple;
  fog: FogConfiguration;
  statusLabel: typeof formerlyEditorAuthoredStatusLabel;
  source: readonly string[];
}

export interface TalkingIslandCameraOverrides {
  clearColor: ColorRgbaTuple;
  alpha: number;
  beta: number;
  radius: number;
  lowerRadiusLimit: number;
  upperRadiusLimit: number;
  minZ: number;
  maxZ: number;
  targetOffsetAboveSpawnPoint: Vector3Tuple;
  statusLabel: typeof formerlyEditorAuthoredStatusLabel;
  source: string;
}

const lightsSavedInBothEditorScenes: PresentationConfiguration["lights"] = {
  sky: {
    name: "Sky light",
    intensity: 0.65,
    direction: [0, 1, 0],
    diffuse: [1, 1, 1],
    specular: [1, 1, 1],
    groundColor: [0.2980392156862745, 0.34509803921568627, 0.30196078431372547],
  },
  sun: {
    name: "Sunlight",
    intensity: 0.65,
    direction: [-0.5, -1, 0.6],
    position: [12, 25, -12],
    diffuse: [1, 0.9411764705882353, 0.807843137254902],
    specular: [1, 1, 1],
  },
};

const fogDistancesSavedInBothEditorScenes = { enabled: true, start: 32, end: 85, density: 0.006, color: [0.49, 0.59, 0.56] } as const;

export const nativeSandboxPresentation: PresentationConfiguration = {
  camera: {
    name: "World camera",
    alpha: -1.7999999999999998,
    beta: 1.15,
    radius: 4.25,
    target: [0.6, 0.15, 0],
    minZ: 0.005,
    maxZ: 100,
    fov: 0.9,
    fovMode: 1,
    lowerRadiusLimit: 0.4,
    upperRadiusLimit: 10,
    lowerBetaLimit: 0.35,
    upperBetaLimit: 1.45,
    inertia: 0.7,
    panningInertia: 0.9,
    speed: 2,
    pinchToPanMaxDistance: 20,
    allowUpsideDown: true,
  },
  lights: lightsSavedInBothEditorScenes,
  clearColor: [0.49, 0.59, 0.56, 1],
  ambientColor: [0, 0, 0],
  fog: { ...fogDistancesSavedInBothEditorScenes, mode: 0 },
  statusLabel: formerlyEditorAuthoredStatusLabel,
  source: [
    "assets/native-parity.scene/cameras/World camera.json",
    "assets/native-parity.scene/lights/Sky light.json",
    "assets/native-parity.scene/lights/Sunlight.json",
    "assets/native-parity.scene/config.json",
  ],
};

export const referenceWorldPresentation: PresentationConfiguration = {
  camera: {
    name: "World camera",
    alpha: -1.5707963267948966,
    beta: 1.05,
    radius: 26,
    target: [0, 0.8, 1],
    minZ: 0.1,
    maxZ: 250,
    fov: 0.9,
    fovMode: 1,
    lowerRadiusLimit: 10,
    upperRadiusLimit: 38,
    lowerBetaLimit: 0.35,
    upperBetaLimit: 1.45,
    inertia: 0.7,
    panningInertia: 0.9,
    speed: 2,
    pinchToPanMaxDistance: 20,
    allowUpsideDown: true,
  },
  lights: lightsSavedInBothEditorScenes,
  clearColor: [0.49, 0.59, 0.56, 1],
  ambientColor: [0, 0, 0],
  fog: { ...fogDistancesSavedInBothEditorScenes, mode: 3 },
  statusLabel: formerlyEditorAuthoredStatusLabel,
  source: [
    "assets/example.scene/cameras/world-camera.json",
    "assets/example.scene/lights/sky-light.json",
    "assets/example.scene/lights/sunlight.json",
    "assets/example.scene/config.json",
  ],
};

export const talkingIslandCameraOverrides: TalkingIslandCameraOverrides = {
  clearColor: [0.58, 0.71, 0.8, 1],
  alpha: -Math.PI / 2.5,
  beta: 1.1,
  radius: 8,
  lowerRadiusLimit: 1,
  upperRadiusLimit: 50,
  minZ: 0.05,
  maxZ: 4000,
  targetOffsetAboveSpawnPoint: [0, 0.5, 0],
  statusLabel: formerlyEditorAuthoredStatusLabel,
  source: "src/scene/loadEnvironment.ts at commit 58ac027",
};
