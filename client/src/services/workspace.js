import { useCallback, useSyncExternalStore } from "react"

import * as store from "./localStore"

/**
 * The signed-in user's own documents: CV versions, their analyses, and job
 * matches. Persisted to `localStorage` under the account id, never to the server.
 *
 * This file is only the React binding — the store and the projections over it
 * live in `localStore.js`, which has no React in it and can be exercised directly.
 *
 * Reading through `useSyncExternalStore` rather than mirroring the store in
 * state has two consequences worth stating:
 *
 *  - A write that fails cannot leave the screen showing something that is not
 *    there. `update` throws on a full origin, and because nothing was written the
 *    snapshot does not change — so the UI stays exactly as it was, which is the
 *    truth.
 *  - Signing in or out needs no load effect. The account id is an argument, so
 *    the snapshot swaps with the session, and two accounts on one browser can
 *    never see each other's documents.
 */

/**
 * The account's documents as React state.
 *
 * @param {string|null} userId  the signed-in account, or null when signed out
 */
export function useWorkspace(userId) {
  return useSyncExternalStore(
    useCallback((listener) => store.subscribe(listener), []),
    useCallback(() => store.getWorkspace(userId), [userId]),
  )
}

/** Bytes this browser is holding for one account, for the settings page. */
export function useStorageFootprint(userId) {
  return useSyncExternalStore(
    useCallback((listener) => store.subscribe(listener), []),
    useCallback(() => store.storageFootprint(userId), [userId]),
  )
}

/**
 * Applies a change to the account's documents and saves it.
 *
 * Throws `LocalStoreError` when the origin is full or blocked — the one failure
 * the UI must surface, because it means the change the user just made did not
 * survive.
 */
export function update(userId, updater) {
  return store.updateWorkspace(userId, updater)
}

/** Forgets the account's documents. Used when the account itself is deleted. */
export function clear(userId) {
  store.clearWorkspace(userId)
}

/** A fresh id for a version. The browser owns identity here, not the server. */
export function newId() {
  return store.newId()
}

export { removeResume, sortVersions, summariseMatches, toVersion } from "./localStore"