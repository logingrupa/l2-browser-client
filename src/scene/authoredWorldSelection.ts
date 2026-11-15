export const authoredWorldParameter = "authored";
const authoredWorldSelectedValue = "1";

export function isAuthoredWorldSelected(search: string): boolean {
  return new URLSearchParams(search).get(authoredWorldParameter) === authoredWorldSelectedValue;
}

export function selectAuthoredWorld(parameters: URLSearchParams, authored: boolean): void {
  if (authored) parameters.set(authoredWorldParameter, authoredWorldSelectedValue);
  else parameters.delete(authoredWorldParameter);
}
