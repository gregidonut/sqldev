export function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();

    // Normalize both to midnight for day comparison
    const todayMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
    );
    const dateMidnight = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
    );
    const daysDiff = Math.round(
        (todayMidnight.getTime() - dateMidnight.getTime()) / 86_400_000,
    );

    const kitchenTime = date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
    });
    switch (true) {
        case daysDiff === 0:
            return kitchenTime;
        case daysDiff === 1:
            return `yesterday ${kitchenTime}`;
        case daysDiff <= 6:
            return `${date.toLocaleDateString(undefined, { weekday: "long" })} ${kitchenTime}`;
        default:
            return date.toLocaleDateString();
    }
}
