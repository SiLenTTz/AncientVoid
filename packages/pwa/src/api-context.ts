import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { hubApi, type HubApi } from "./api.ts";

/**
 * EPIC-P6: which host a view talks to. A session view of another host
 * provides hostApi(hostId); everything inside (composer, search, voice,
 * skills) then reaches that host through this hub.
 */
export const ApiContext = createContext<HubApi>(hubApi);

export function useApi(): HubApi {
  return useContext(ApiContext);
}
