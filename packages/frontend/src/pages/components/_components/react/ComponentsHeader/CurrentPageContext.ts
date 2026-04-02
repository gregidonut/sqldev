import React, {createContext, useContext} from 'react';

export const CurrentPageContext = createContext<string>('');

export function useCurrentPage() {
    return useContext(CurrentPageContext);
}