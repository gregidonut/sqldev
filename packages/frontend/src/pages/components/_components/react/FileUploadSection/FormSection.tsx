import React, {useState} from "react";
import {FileTrigger, type FileTriggerProps} from 'react-aria-components';
import {Form} from '@/components/ui/Form';
import {Button} from '@/components/ui/Button';

export default function FormSection(props: FileTriggerProps): React.JSX.Element {
    const [files, setFiles] = useState<File[]>([]);

    return (
        <Form
            action={async () => {
                if (files.length === 0) {
                    return;
                }

                const formData = new FormData();

                for (const file of files) {
                    formData.append("files", file);
                }

                const response = await fetch("/api/igPostAttachments/post", {
                    method: "POST",
                    body: formData,
                });

                const result = await response.json();

                if (!response.ok) {
                    console.error(result);
                    return;
                }

                console.log(result);
            }}>
            <section>
                <FileTrigger
                    {...props}
                    acceptedFileTypes={["image/*"]}
                    onSelect={(selected) => {
                        const nextFiles = selected ? Array.from(selected) : [];
                        setFiles(nextFiles);
                    }}>
                    <Button>Select a file</Button>
                </FileTrigger>
                {files.length > 0 ? files.map((file) => file.name).join(", ") : "No file selected"}
            </section>
            <Button type="submit" isDisabled={files.length === 0}>Submit</Button>
        </Form>
    );
};