import { styleTags, tags } from '@lezer/highlight';
import { Parser, NodeType, NodeSet, Tree } from '@lezer/common';
import { TypstWasmParser } from '../wasm/typst_syntax.js';
import { StateField } from '@codemirror/state';
import { language, defineLanguageFacet, HighlightStyle, LanguageSupport, Language, syntaxHighlighting } from '@codemirror/language';

class TypstParseContext {
    /**
    @internal
    */
    constructor(parser, 
    /**
    @internal
    */
    input, fragments, 
    /**
    @internal
    */
    ranges) {
        this.parser = parser;
        this.input = input;
        this.ranges = ranges;
        this.stoppedAt = null;
        this.parsed = 0;
    }
    get parsedPos() {
        return this.parsed;
    }
    advance() {
        return this.parser.tree();
    }
    stopAt(pos) {
        if (this.stoppedAt != null && this.stoppedAt < pos)
            throw new RangeError("Can't move stoppedAt forward");
        this.stoppedAt = pos;
    }
}
class TypstParser extends Parser {
    /**
    @internal
    */
    constructor(highlighting) {
        super();
        this.parser = null;
        this.last_tree = null;
        const syntax_types = TypstWasmParser.get_node_types();
        const node_types = [NodeType.none];
        for (const [ty_name, ty_id] of syntax_types) {
            node_types.push(NodeType.define({
                name: ty_name,
                id: ty_id
            }));
        }
        this.nodeSet = new NodeSet(node_types).extend(highlighting);
    }
    /**
    Get an update listener for syncing typst parser state with the document
    */
    updateListener() {
        let parser = this;
        return StateField.define({
            create() { return null; },
            update(value, transaction) {
                if (transaction.startState.facet(language) != transaction.state.facet(language)) {
                    parser.clearParser();
                    return null;
                }
                if (transaction.docChanged) {
                    transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                        var _a;
                        let edits = (_a = parser.parser) === null || _a === void 0 ? void 0 : _a.edit(fromA, toA, inserted.toString());
                        if (edits.full_update) {
                            parser.clearTree();
                        }
                        else {
                            // Apply incremental edits
                            for (const edit of edits.edits) {
                                parser.applyTreeEdit(edit);
                            }
                        }
                    });
                }
                return null;
            }
        });
    }
    createParse(input, fragments, ranges) {
        if (this.parser == null)
            this.parser = new TypstWasmParser(input.read(0, input.length));
        let parse = new TypstParseContext(this, input, fragments, ranges);
        return parse;
    }
    clearTree() {
        this.last_tree = null;
    }
    /**
    Clears all internal parser state,
    This should be called when the editor state is being replaced, which won't cause
    a document change event and will cause the parse lose sync with the editor.
    */
    clearParser() {
        this.parser = null;
        this.clearTree();
    }
    applyTreeEdit(edit) {
        var _a, _b, _c;
        let parent;
        let positions;
        switch (edit.kind) {
            case "ChildrenSplice":
                parent = locateSubTree(this.last_tree, edit.prefix);
                for (const newChild of edit.replacement) {
                    mountPrototypes(this.nodeSet, newChild);
                }
                // calculate new length
                let superseded_length = parent.children.slice(edit.from, edit.to).reduce((acc, v) => acc + v.length, 0);
                let replacement_length = edit.replacement.reduce((acc, v) => acc + v.length, 0);
                parent.children.splice(edit.from, edit.to - edit.from, ...edit.replacement);
                positions = parent.positions;
                positions.splice(edit.from, edit.to - edit.from, ...new Array(edit.replacement.length).fill(0));
                parent.length += replacement_length - superseded_length;
                let len_acc = ((_a = parent.positions[edit.from - 1]) !== null && _a !== void 0 ? _a : 0) + ((_c = (_b = parent.children[edit.from - 1]) === null || _b === void 0 ? void 0 : _b.length) !== null && _c !== void 0 ? _c : 0);
                for (let i = edit.from; i < parent.positions.length; i++) {
                    positions[i] = len_acc;
                    len_acc += parent.children[i].length;
                }
                break;
            case "UpdateParent":
                let i = edit.prefix.pop();
                parent = locateSubTree(this.last_tree, edit.prefix);
                const delta = edit.new - edit.prev;
                parent.length += delta;
                positions = parent.positions;
                for (let j = i + 1; j < parent.positions.length; j++) {
                    positions[j] += delta;
                }
                break;
        }
    }
    tree() {
        var _a;
        if (this.last_tree)
            return this.last_tree;
        let parsed = (_a = this.parser) === null || _a === void 0 ? void 0 : _a.tree();
        if (parsed == null)
            return null;
        this.last_tree = mountPrototypes(this.nodeSet, parsed);
        return this.last_tree;
    }
}
function locateSubTree(tree, prefix) {
    let curr = tree;
    for (const i of prefix) {
        curr = curr.children[i];
    }
    return curr;
}
// Recursively mount prototypes onto the parsed tree
function mountPrototypes(nodeSet, tree) {
    Object.setPrototypeOf(tree, Tree.prototype);
    tree.type = nodeSet.types[tree.kind];
    for (const child of tree.children) {
        mountPrototypes(nodeSet, child);
    }
    return tree;
}

const typstHighlight = /*@__PURE__*/styleTags({
    "Shebang": tags.documentMeta,
    "LineComment BlockComment": tags.comment,
    "Text": tags.content,
    // "Space": typstTags["Space"],
    "Linebreak": tags.contentSeparator,
    // "ParBreak": typstTags["ParBreak"],
    "Escape": tags.escape,
    "Shorthand": tags.contentSeparator,
    "SmartQuote": tags.quote,
    "Strong/...": tags.strong,
    "Emph/...": tags.emphasis,
    "RawLang": tags.annotation,
    "RawDelim": tags.controlKeyword,
    "Raw": tags.monospace,
    // RawTrimmed
    "Link": tags.link,
    "Label": tags.labelName,
    "Ref/...": tags.labelName,
    "Heading/...": tags.heading,
    // HeadingMarker
    // "ListItem/...": tags.list,
    // "EnumItem/...": tags.list,
    "ListMarker": tags.list,
    "EnumMarker": tags.list,
    // "TermItem/...": tag,
    "TermMarker": tags.definitionOperator,
    // "Equation": typstTags["Equation"],
    // "Math": typstTags["Math"],
    "MathText": /*@__PURE__*/tags.special(tags.string),
    "MathIdent": /*@__PURE__*/tags.special(tags.variableName),
    "MathShorthand MathAlignPoint MathDelimited MathAttach MathPrimes MathFrac MathRoot": /*@__PURE__*/tags.special(tags.contentSeparator),
    "Error": tags.invalid,
    "Hash": tags.controlKeyword,
    "LeftBrace RightBrace": tags.brace,
    "LeftBracket RightBracket": tags.bracket,
    "LeftParen RightParen": tags.paren,
    "Comma": tags.separator,
    "Semicolon Colon Dot Dots": tags.punctuation,
    // "Star" : TODO:
    // Underscore
    "Dollar": tags.controlKeyword,
    "Plus Minus Slash Hat": tags.arithmeticOperator,
    "Prime": tags.typeOperator,
    "Eq PlusEq HyphEq SlashEq StarEq": tags.updateOperator,
    "EqEq ExclEq Lt LtEq Gt GtEq": tags.compareOperator,
    "Arrow": tags.controlOperator,
    "Root": tags.arithmeticOperator,
    "Not And Or": tags.operatorKeyword,
    "None Auto": tags.literal,
    "If Else For While Break Continue Return": tags.controlKeyword,
    "Import Include": tags.moduleKeyword,
    "Let Set Show Context": tags.definitionKeyword,
    "As In": tags.operatorKeyword,
    "Code": tags.monospace,
    "Ident": tags.variableName,
    "Bool": tags.bool,
    "Int": tags.integer,
    "Float": tags.float,
    "Numeric": tags.number,
    "Str": tags.string,
    // CodeBlock
    // ContentBlock
    // Parenthesized
    // Array
    // Dict
    // Named
    // Keyed
    // Unary
    // Binary
    // FieldAccess
    // FuncCall
    // Args
    // Spread
    // Closure
    // Params
    // LetBinding
    // SetRule
    // ShowRule
    // Contextual
    // Conditional
    // WhileLoop
    // ForLoop
    // ModuleImport
    // ImportItems
    // ImportItemPath
    // RenamedImportItem
    // ModuleInclude
    // LoopBreak
    // LoopContinue
    // FuncReturn
    // Destructuring
    // DestructAssignment
});

const data = /*@__PURE__*/defineLanguageFacet({ commentTokens: { block: { open: "/*", close: "*/" } } });
const TypstHighlightSytle = /*@__PURE__*/HighlightStyle.define([
    { tag: tags.heading, color: "black", fontWeight: 'bold', textDecoration: 'underline' },
    { tag: tags.comment, color: "green" },
    { tag: tags.processingInstruction, color: "fuchsia" },
    { tag: tags.controlKeyword, color: "#d73a49" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: 'bold' },
    { tag: tags.literal, color: 'deeppink', fontWeight: 'bold' },
    { tag: tags.controlKeyword, color: 'deeppink', fontWeight: 'bold' },
    { tag: tags.moduleKeyword, color: 'deeppink', fontWeight: 'bold' },
    { tag: tags.operatorKeyword, color: 'deeppink', fontWeight: 'bold' },
    { tag: tags.definitionKeyword, color: 'deeppink', fontWeight: 'bold' },
    { tag: tags.name, color: "slateblue" },
    { tag: tags.brace, color: "hotpink" },
    { tag: tags.bracket, color: "blue" },
    { tag: tags.paren, color: "red" },
    { tag: tags.labelName, color: "purple" },
    { tag: tags.monospace, fontFamily: "monospace", },
]);
function typst() {
    let parser = new TypstParser(typstHighlight);
    let updateListener = parser.updateListener();
    return new LanguageSupport(new Language(data, parser, [
        updateListener,
        syntaxHighlighting(TypstHighlightSytle)
    ], 'typst'));
}

export { TypstHighlightSytle, TypstParseContext, TypstParser, typst, typstHighlight };
