import { Autocomplete, useFilter } from "react-aria-components";
import { MenuTrigger, Menu, MenuItem } from "./Menu/Menu.tsx";
import { Button } from "./Menu/Button.tsx";
import { SearchField } from "./Menu/SearchField.tsx";

export default function Index({
    pathname,
    staticpaths,
}: {
    pathname: string;
    staticpaths: string[];
}) {
    let { contains } = useFilter({ sensitivity: "base" });

    return (
        <nav>
            <MenuTrigger>
                <h2>
                    <Button>{pathname}</Button>
                </h2>
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        maxHeight: "inherit",
                    }}
                >
                    <Autocomplete filter={contains}>
                        <SearchField
                            aria-label="Search Components"
                            placeholder="Search Components"
                            autoFocus
                            style={{ margin: 4 }}
                        />
                        <Menu style={{ flex: 1 }}>
                            {staticpaths.map(function (path, index) {
                                return (
                                    <MenuItem
                                        href={`/components/${path}`}
                                        isDisabled={pathname === path}
                                        key={index}
                                    >
                                        {path}
                                    </MenuItem>
                                );
                            })}
                        </Menu>
                    </Autocomplete>
                </div>
            </MenuTrigger>
        </nav>
    );
}
