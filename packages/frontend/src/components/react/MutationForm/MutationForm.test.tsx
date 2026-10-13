import { afterEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { mutationOptions } from "@tanstack/react-query";
import {
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import { MutationForm } from "./MutationForm.tsx";
import { TextInputField } from "./fields/TextInputField.tsx";
import { SubmitButton } from "./fields/SubmitButton.tsx";
import { useMutationFormState } from "./MutationFormContext.ts";

afterEach(() => cleanup());

type Values = { name: string };

function makeClient() {
    return new QueryClient({
        defaultOptions: { mutations: { retry: false } },
    });
}

/** A control that submits through the shared guarded path, like the editor. */
function ShortcutButton() {
    const { submit } = useMutationFormState();
    return (
        <button type="button" data-testid="shortcut" onClick={() => submit()}>
            shortcut submit
        </button>
    );
}

function Harness({
    mutationFn,
    resolveControls,
    required = true,
}: {
    mutationFn: (v: Values) => Promise<void>;
    resolveControls?: (release: () => void) => void;
    required?: boolean;
}) {
    const options = mutationOptions<void, Error, Values>({ mutationFn });
    return (
        <QueryClientProvider client={makeClient()}>
            <MutationForm<Values, Values, void>
                formOptions={{ defaultValues: { name: "" } }}
                mutationOptions={options}
            >
                <TextInputField<Values>
                    name="name"
                    rules={required ? { required: "name is required." } : undefined}
                    isRequired={required}
                    dataCy="name_field"
                />
                <SubmitButton dataCy="submit">Submit</SubmitButton>
                <ShortcutButton />
            </MutationForm>
        </QueryClientProvider>
    );
}

describe("MutationForm guarded submit", () => {
    test("invalid values start no mutation (validation before conversion)", async () => {
        const mutationFn = mock(async () => {});
        render(<Harness mutationFn={mutationFn} />);
        await act(async () => {
            screen.getByTestId("shortcut").click();
        });
        await waitFor(() => {
            expect(mutationFn).toHaveBeenCalledTimes(0);
        });
    });

    test("overlapping submissions start at most one mutation before settlement", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const mutationFn = mock(async (_v: Values) => {
            await gate;
        });

        render(
            <Harness mutationFn={mutationFn} />,
        );

        // Fill a valid value.
        const input = document.querySelector("input") as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: "hello" } });
        });

        // Fire shortcut + button in the same turn.
        await act(async () => {
            screen.getByTestId("shortcut").click();
            const submitBtn = document.querySelector(
                'button[type="submit"]',
            ) as HTMLButtonElement;
            submitBtn.click();
        });

        await waitFor(() => {
            expect(mutationFn).toHaveBeenCalledTimes(1);
        });

        // Release and confirm a later submission can start a new mutation.
        await act(async () => {
            release();
            await Promise.resolve();
        });
    });
});
