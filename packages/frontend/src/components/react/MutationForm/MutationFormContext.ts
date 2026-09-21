import { createContext, useContext } from "react";

export interface MutationFormState {
    isPending: boolean;
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
