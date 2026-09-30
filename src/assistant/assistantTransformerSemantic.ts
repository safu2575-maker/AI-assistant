import { AssistantAnswerContext } from "./assistantTypes";

export interface TransformerSemanticRewrite {
    question: string;
    reason: string;
    score: number;
}

export class AssistantTransformerSemantic {
    constructor(_context: AssistantAnswerContext) {}

    updateContext(_context: AssistantAnswerContext): void {}

    warmUp(): Promise<void> | null {
        return null;
    }

    async suggestRewrite(_question: string): Promise<TransformerSemanticRewrite | null> {
        return null;
    }
}
