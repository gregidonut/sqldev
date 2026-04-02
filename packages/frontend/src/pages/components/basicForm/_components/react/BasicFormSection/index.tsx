import React from 'react';
import {useForm} from 'react-hook-form';
import {Form} from '@/components/ui/Form.tsx';
import {Button} from '@/components/ui/Button.tsx';
import {BasicFormSectionContext, type BasicFormSectionData} from "./BasicFormSectionContext.ts";
import OrderNumberField
    from "./Fields/OrderNumberField.tsx";
import NameField
    from "./Fields/NameField.tsx";
import EmailField
    from "./Fields/EmailField.tsx";
import MobileNumberField
    from "./Fields/MobileNumberField.tsx";
import PaymentMethodField
    from "./Fields/PaymentMethodField.tsx";


export default function BasicFormSection(): React.JSX.Element {
    let {handleSubmit, control} = useForm<BasicFormSectionData>({
        defaultValues: {
            orderNumber: Date.now().valueOf().toString(),
            customerName: "",
            email: "",
            mobileNumber: "",
            // paymentMethod: "Cash on Delivery"
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
                    <PaymentMethodField/>
                </BasicFormSectionContext.Provider>
                <Button type="submit" className="max-w-20">Submit</Button>
            </Form>
        </section>
    );
}