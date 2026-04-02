import {useForm, Controller} from 'react-hook-form';
import React from "react";
import {FileTrigger, type FileTriggerProps} from 'react-aria-components';
import {Form} from '@/components/ui/Form.tsx';
import {Button} from '@/components/ui/Button.tsx';
import {
    useMutation
} from "@tanstack/react-query";
import axios from "axios";

function submitForm(data: FormData) {
    return axios({
        method: "post",
        url: '/api/igPostAttachments/post',
        data,
        headers: {'Content-Type': 'multipart/form-data'}
    });
}

type FormSectionData = {
    files: File[];
}

export default function FormSection(props: FileTriggerProps): React.JSX.Element {
    let {handleSubmit, control, reset, watch} = useForm<FormSectionData>({
        defaultValues: {
            files: [],
        },
    });

    const selectedFiles = watch("files") as File[];

    const {mutate, isPending} = useMutation({
        mutationFn: submitForm,
        onSuccess: () => {
            reset({files: []});
            window.location.reload();
        },
        onError: (error) => console.log(error)
    });


    let onSubmit = (data: FormSectionData) => {
        const formData = new FormData();

        for (const file of data.files) {
            formData.append("files", file);
        }
        mutate(formData)
    };


    return (
        <Form onSubmit={handleSubmit(onSubmit)}>
            <Controller
                control={control}
                name="files"
                rules={{required: true, minLength: 1}}
                render={({
                             field: {name, value, onChange, onBlur, ref},
                             fieldState: {invalid, error},
                         }) => (
                    <>
                        <FileTrigger
                            {...props}
                            acceptedFileTypes={["image/*"]}
                            onSelect={(selected) => {
                                const nextFiles = selected ? Array.from(selected) : [];
                                onChange(nextFiles);
                            }}>
                            <Button>Select a file</Button>
                        </FileTrigger>
                        {selectedFiles.length > 0
                            ? selectedFiles.map((file) => file.name).join(", ")
                            : "No file selected"}
                    </>
                )}/>
            <Button type="submit" isDisabled={isPending}>
                {isPending ? "Submitting..." : "Submit"}
            </Button>
        </Form>
    );
}

