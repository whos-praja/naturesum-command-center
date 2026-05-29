/**
 * LiveDataContext — single source of truth for the most recently uploaded
 * MIS sheet. Components anywhere in the tree can:
 *   - read `live` (the parsed payload, or null if nothing uploaded yet)
 *   - call `setLive(payload)` to commit a new upload (persists to
 *     localStorage and broadcasts to all subscribers)
 *   - call `clearLive()` to revert to synth data
 *
 * Keep this provider near the root (in App.jsx) so the Inventory page,
 * topbar timestamp, and any future module can all subscribe.
 */
import { createContext, useContext, useState, useCallback } from "react";
import { loadLiveInventory, saveLiveInventory } from "../lib/liveInventory.js";

const LiveDataContext = createContext({
  live: null,
  setLive: () => {},
  clearLive: () => {},
});

export function LiveDataProvider({ children }) {
  const [live, setLiveState] = useState(() => loadLiveInventory());

  const setLive = useCallback((payload) => {
    saveLiveInventory(payload);
    setLiveState(payload);
  }, []);

  const clearLive = useCallback(() => {
    saveLiveInventory(null);
    setLiveState(null);
  }, []);

  return (
    <LiveDataContext.Provider value={{ live, setLive, clearLive }}>
      {children}
    </LiveDataContext.Provider>
  );
}

export function useLiveData() {
  return useContext(LiveDataContext);
}
