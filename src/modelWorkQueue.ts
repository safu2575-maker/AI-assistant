/** Background summaries share one Power BI host query slot with foreground work. */
export class ModelWorkQueue {
    private generation = 0;
    private background: Promise<unknown> = Promise.resolve();
    private foreground: Promise<unknown> = Promise.resolve();

    invalidate(): void { this.generation++; }

    run<T>(background: boolean, work: () => Promise<T>): Promise<T> {
        if (!background) {
            this.generation++;
            const result = work(); // Foreground execution cancels the old host request.
            this.foreground = result.catch(() => undefined);
            return result;
        }
        const generation = this.generation;
        const result = Promise.all([this.background, this.foreground]).then(() => {
            if (generation !== this.generation) throw new Error('Query cancelled.');
            return work();
        });
        this.background = result.catch(() => undefined);
        return result;
    }
}

