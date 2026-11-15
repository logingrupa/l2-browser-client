import committedMovementRulesText from "../../recipes/world/movement-native-rules.json?raw";
import { parseMovementNativeRules, type MovementNativeRules } from "../scene/world/movement/core/movementRules";

export const committedMovementRules: MovementNativeRules = parseMovementNativeRules(JSON.parse(committedMovementRulesText));
