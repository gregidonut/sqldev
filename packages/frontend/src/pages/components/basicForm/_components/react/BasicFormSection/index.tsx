import React from 'react';
import {useForm} from 'react-hook-form';
import {Form} from '@/components/ui/Form.tsx';
import {Button} from '@/components/ui/Button.tsx';
import {type BasicFormSectionData} from "./BasicFormSectionData.ts";
import {BasicFormSectionContext} from "./BasicFormSectionContext.ts";
import OrderNumberField
    from "./Fields/OrderNumberField.tsx";
import NameField
    from "./Fields/NameField.tsx";
import EmailField
    from "./Fields/EmailField.tsx";
import MobileNumberField
    from "./Fields/MobileNumberField.tsx";


export default function BasicFormSection(): React.JSX.Element {
    let {handleSubmit, control} = useForm<BasicFormSectionData>({
        defaultValues: {
            orderNumber: Date.now().valueOf().toString(),
            customerName: "",
            email: "",
            mobileNumber: "",
        },
        mode: 'onChange',
    });

    let onSubmit = (data: BasicFormSectionData) => {
        console.log(data)
    };

    return (
        <section className="w-full">
            <Form onSubmit={handleSubmit(onSubmit)} autoComplete="off">
                <BasicFormSectionContext.Provider value={control}>
                    <OrderNumberField/>
                    <NameField/>
                    <EmailField/>
                    <MobileNumberField/>
                </BasicFormSectionContext.Provider>
                <Button type="submit" className="max-w-20">Submit</Button>
            </Form>
        </section>
    );
}