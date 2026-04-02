import React from 'react';
import {useForm, Controller} from 'react-hook-form';
import {Form} from '@/components/ui/Form.tsx';
import {Button} from '@/components/ui/Button.tsx';
import {TextField} from '@/components/ui/TextField';

type BasicFormSectionData = {
    orderNumber: string;
    customerName: string;
    email: string;
    mobileNumber: string;
}
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
            <Form onSubmit={handleSubmit(onSubmit)}>
                <Controller
                    control={control}
                    name="orderNumber"
                    rules={{required: 'order number is required.'}}
                    render={({
                                 field: {name, value, onChange, onBlur, ref},
                                 fieldState: {invalid, error},
                             }) => (
                        <TextField
                            isDisabled={true}
                            label={name}
                            name={name}
                            value={value}
                            onChange={onChange}
                            onBlur={onBlur}
                            ref={ref}
                            isRequired
                            // Let React Hook Form handle validation instead of the browser.
                            validationBehavior="aria"
                            isInvalid={invalid}
                            errorMessage={error?.message}/>
                    )}/>
                <Controller
                    control={control}
                    name="customerName"
                    rules={{required: 'Name is required.'}}
                    render={({
                                 field: {name, value, onChange, onBlur, ref},
                                 fieldState: {invalid, error},
                             }) => (
                        <TextField
                            label={name}
                            name={name}
                            value={value}
                            onChange={onChange}
                            onBlur={onBlur}
                            ref={ref}
                            isRequired
                            // Let React Hook Form handle validation instead of the browser.
                            validationBehavior="aria"
                            isInvalid={invalid}
                            errorMessage={error?.message}/>
                    )}/>
                <Controller
                    control={control}
                    name="email"
                    rules={{
                        required: 'email is required.',
                        pattern: {
                            value: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
                            message: 'Invalid email address',
                        }
                    }}
                    render={({
                                 field: {name, value, onChange, onBlur, ref},
                                 fieldState: {invalid, error},
                             }) => (
                        <TextField
                            label={name}
                            name={name}
                            value={value}
                            onChange={onChange}
                            onBlur={onBlur}
                            ref={ref}
                            isRequired
                            // Let React Hook Form handle validation instead of the browser.
                            validationBehavior="aria"
                            isInvalid={invalid}
                            errorMessage={error?.message}/>
                    )}/>
                <Controller
                    control={control}
                    name="mobileNumber"
                    rules={{
                        required: 'mobileNumber is required.',
                        minLength: {value: 10, message: 'Mobile number must be at least 10 digits'},
                        maxLength: {value: 10, message: 'Mobile number must be at least 10 digits'}
                    }}
                    render={function ({
                                          field: {name, value, onChange, onBlur, ref},
                                          fieldState: {invalid, error},
                                      }) {
                        return (
                            <TextField
                                label={name}
                                name={name}
                                value={value}
                                onChange={onChange}
                                onBlur={onBlur}
                                ref={ref}
                                isRequired
                                // Let React Hook Form handle validation instead of the browser.
                                validationBehavior="aria"
                                isInvalid={invalid}
                                errorMessage={error?.message}/>
                        )
                    }}/>
                <Button type="submit" className="max-w-20">Submit</Button>
            </Form>
        </section>
    );
}