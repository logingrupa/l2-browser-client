import type { DevSection } from "../ui/devSheet/DevSheet";
import type { PresentationConfiguration } from "../scene/presentationConfiguration";
import { presentationConfigurationVariables } from "./presentationConfigurationVariables";

export interface ScenePresentationGroupLabels {
  sceneName: string;
  readoutTestId: string;
}

export function attachScenePresentationGroup(section: DevSection, configuration: PresentationConfiguration, labels: ScenePresentationGroupLabels): void {
  const variables = presentationConfigurationVariables(configuration);
  const presentationGroup = section.group("scene-presentation", "Scene presentation", {
    hint: `Camera, lights, clear colour and fog the ${labels.sceneName} is built from. They are browser presentation values carried over from the Editor scene, not Lineage II data.`,
    variables: () => variables,
  });
  presentationGroup.readout({ label: "Presentation", testId: labels.readoutTestId, value: () => `${variables.length} values · presentation, not L2`,
    hint: "Hover for every camera, light, colour and fog value with its tracked source.", variables: () => variables });
}
