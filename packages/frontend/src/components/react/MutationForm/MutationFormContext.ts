import { createContext, useContext } from "react";

export interface MutationFormState {
    readonly isPending: boolean;
    /**
     * The single guarded submission operation. It runs RHF validation, converts
     * valid values, admits at most one unsettled mutation, resets on success,
     * and invokes the caller success callback. Native submit, the submit button,
     * and the editor Ctrl/Cmd+Enter shortcut all go through this one path, so
     * validation and duplicate protection stay consistent.
     */
    readonly submit: () => void;
}

export const MutationFormStateContext = createContext<MutationFormState | null>(
    null,
);

export function useMutationFormState() {
    const state = useContext(MutationFormStateContext);
    if (!state) {
        throw new Error(
            "useMutationFormState must be used within a MutationForm",
        );
    }
    return state;
}
