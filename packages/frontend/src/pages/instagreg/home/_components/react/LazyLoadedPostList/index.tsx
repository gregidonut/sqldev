import React, { Suspense, lazy } from "react";
import { type PostListProps } from "../PostListProps.ts";

const PostList = lazy(() => import("./PostList"));

export default function LazyLoadedPostList(props: PostListProps) {
    return (
        <Suspense fallback={<p>Loading...</p>}>
            <PostList {...props} />
        </Suspense>
    );
}
