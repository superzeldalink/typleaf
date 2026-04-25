import { HighlightStyle, LanguageSupport } from '@codemirror/language';
import * as _lezer_common from '@lezer/common';
import { PartialParse, Parser, NodeSet, Tree, Input, TreeFragment } from '@lezer/common';
import { StateField } from '@codemirror/state';

declare const TypstHighlightSytle: HighlightStyle;
declare function typst(): LanguageSupport;

declare const typstHighlight: _lezer_common.NodePropSource;

declare class TypstParseContext implements PartialParse {
    readonly parser: TypstParser;
    private parsed;
    stoppedAt: number | null;
    get parsedPos(): number;
    advance(): Tree | null;
    stopAt(pos: number): void;
}
type Edit = ChildrenSplice | UpdateParent;
type ChildrenSplice = {
    kind: 'ChildrenSplice';
    prefix: [number];
    from: number;
    to: number;
    replacement: [any];
};
type UpdateParent = {
    kind: 'UpdateParent';
    prefix: [number];
    prev: number;
    new: number;
};
declare class TypstParser extends Parser {
    nodeSet: NodeSet;
    last_tree: Tree | null;
    /**
    Get an update listener for syncing typst parser state with the document
    */
    updateListener(): StateField<null>;
    createParse(input: Input, fragments: readonly TreeFragment[], ranges: readonly {
        from: number;
        to: number;
    }[]): PartialParse;
    clearTree(): void;
    /**
    Clears all internal parser state,
    This should be called when the editor state is being replaced, which won't cause
    a document change event and will cause the parse lose sync with the editor.
    */
    clearParser(): void;
    applyTreeEdit(edit: Edit): void;
    tree(): Tree | null;
}

export { TypstHighlightSytle, TypstParseContext, TypstParser, typst, typstHighlight };
