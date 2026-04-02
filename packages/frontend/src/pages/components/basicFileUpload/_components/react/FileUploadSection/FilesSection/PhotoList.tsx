import { GridList, GridListItem } from "@/components/ui/GridList.tsx";
import { Text } from "react-aria-components";

export type PhotoListProps = {
    id: string;
    name: string;
    url: string;
    userId: string;
};

export default function PhotoList(props: { images: PhotoListProps[] }) {
    return (
        <GridList
            className="w-full"
            aria-label="Nature photos"
            selectionMode="multiple"
            layout="grid"
            items={props.images}
        >
            {function (image) {
                return (
                    <GridListItem textValue={image.name}>
                        <figure>
                            <img
                                src={image.url}
                                width={640}
                                height={480}
                                alt={image.name}
                                className="aspect-video w-full object-contain"
                            />
                            <figcaption>
                                <Text>{image.name}</Text>
                                <br />
                                <Text slot="description">
                                    By {image.userId}
                                </Text>
                            </figcaption>
                        </figure>
                    </GridListItem>
                );
            }}
        </GridList>
    );
}
