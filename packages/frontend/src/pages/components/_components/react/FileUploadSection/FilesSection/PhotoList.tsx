import {GridList, GridListItem} from '@/components/ui/GridList';
import {Text} from 'react-aria-components';

export type PhotoListProps = {
    id: string,
    name: string,
    url: string,
    userId: string,
}

export default function PhotoList(props: { images: PhotoListProps[] }) {
    return (
        <GridList
            className="w-full"
            aria-label="Nature photos"
            selectionMode="multiple"
            layout="grid"
            items={props.images}>
            {function (image) {
                return (
                    <GridListItem textValue={image.name}>
                        <img src={image.url} width={400} height={600} alt={image.name}/>
                        <Text>{image.name}</Text>
                        <Text slot="description">By {image.userId}</Text>
                    </GridListItem>
                )
            }}
        </GridList>
    );
}
