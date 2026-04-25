'use strict';

var highlight = require('@lezer/highlight');
var common = require('@lezer/common');
var typst_syntax_js = require('../wasm/typst_syntax.js');
var state = require('@codemirror/state');
var language = require('@codemirror/language');

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
class TypstParser extends common.Parser {
    /**
    @internal
    */
    constructor(highlighting) {
        super();
        this.parser = null;
        this.last_tree = null;
        const syntax_types = typst_syntax_js.TypstWasmParser.get_node_types();
        const node_types = [common.NodeType.none];
        for (const [ty_name, ty_id] of syntax_types) {
            node_types.push(common.NodeType.define({
                name: ty_name,
                id: ty_id
            }));
        }
        this.nodeSet = new common.NodeSet(node_types).extend(highlighting);
    }
    /**
    Get an update listener for syncing typst parser state with the document
    */
    updateListener() {
        let parser = this;
        return state.StateField.define({
            create() { return null; },
            update(value, transaction) {
                if (transaction.startState.facet(language.language) != transaction.state.facet(language.language)) {
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
            this.parser = new typst_syntax_js.TypstWasmParser(input.read(0, input.length));
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
    Object.setPrototypeOf(tree, common.Tree.prototype);
    tree.type = nodeSet.types[tree.kind];
    for (const child of tree.children) {
        mountPrototypes(nodeSet, child);
    }
    return tree;
}

const typstHighlight = highlight.styleTags({
    "Shebang": highlight.tags.documentMeta,
    "LineComment BlockComment": highlight.tags.comment,
    "Text": highlight.tags.content,
    // "Space": typstTags["Space"],
    "Linebreak": highlight.tags.contentSeparator,
    // "ParBreak": typstTags["ParBreak"],
    "Escape": highlight.tags.escape,
    "Shorthand": highlight.tags.contentSeparator,
    "SmartQuote": highlight.tags.quote,
    "Strong/...": highlight.tags.strong,
    "Emph/...": highlight.tags.emphasis,
    "RawLang": highlight.tags.annotation,
    "RawDelim": highlight.tags.controlKeyword,
    "Raw": highlight.tags.monospace,
    // RawTrimmed
    "Link": highlight.tags.link,
    "Label": highlight.tags.labelName,
    "Ref/...": highlight.tags.labelName,
    "Heading/...": highlight.tags.heading,
    // HeadingMarker
    // "ListItem/...": tags.list,
    // "EnumItem/...": tags.list,
    "ListMarker": highlight.tags.list,
    "EnumMarker": highlight.tags.list,
    // "TermItem/...": tag,
    "TermMarker": highlight.tags.definitionOperator,
    // "Equation": typstTags["Equation"],
    // "Math": typstTags["Math"],
    "MathText": highlight.tags.special(highlight.tags.string),
    "MathIdent": highlight.tags.special(highlight.tags.variableName),
    "MathShorthand MathAlignPoint MathDelimited MathAttach MathPrimes MathFrac MathRoot": highlight.tags.special(highlight.tags.contentSeparator),
    "Error": highlight.tags.invalid,
    "Hash": highlight.tags.controlKeyword,
    "LeftBrace RightBrace": highlight.tags.brace,
    "LeftBracket RightBracket": highlight.tags.bracket,
    "LeftParen RightParen": highlight.tags.paren,
    "Comma": highlight.tags.separator,
    "Semicolon Colon Dot Dots": highlight.tags.punctuation,
    // "Star" : TODO:
    // Underscore
    "Dollar": highlight.tags.controlKeyword,
    "Plus Minus Slash Hat": highlight.tags.arithmeticOperator,
    "Prime": highlight.tags.typeOperator,
    "Eq PlusEq HyphEq SlashEq StarEq": highlight.tags.updateOperator,
    "EqEq ExclEq Lt LtEq Gt GtEq": highlight.tags.compareOperator,
    "Arrow": highlight.tags.controlOperator,
    "Root": highlight.tags.arithmeticOperator,
    "Not And Or": highlight.tags.operatorKeyword,
    "None Auto": highlight.tags.literal,
    "If Else For While Break Continue Return": highlight.tags.controlKeyword,
    "Import Include": highlight.tags.moduleKeyword,
    "Let Set Show Context": highlight.tags.definitionKeyword,
    "As In": highlight.tags.operatorKeyword,
    "Code": highlight.tags.monospace,
    "Ident": highlight.tags.variableName,
    "Bool": highlight.tags.bool,
    "Int": highlight.tags.integer,
    "Float": highlight.tags.float,
    "Numeric": highlight.tags.number,
    "Str": highlight.tags.string,
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

const data = language.defineLanguageFacet({ commentTokens: { block: { open: "/*", close: "*/" } } });
const TypstHighlightSytle = language.HighlightStyle.define([
    { tag: highlight.tags.heading, color: "black", fontWeight: 'bold', textDecoration: 'underline' },
    { tag: highlight.tags.comment, color: "green" },
    { tag: highlight.tags.processingInstruction, color: "fuchsia" },
    { tag: highlight.tags.controlKeyword, color: "#d73a49" },
    { tag: highlight.tags.emphasis, fontStyle: "italic" },
    { tag: highlight.tags.strong, fontWeight: 'bold' },
    { tag: highlight.tags.literal, color: 'deeppink', fontWeight: 'bold' },
    { tag: highlight.tags.controlKeyword, color: 'deeppink', fontWeight: 'bold' },
    { tag: highlight.tags.moduleKeyword, color: 'deeppink', fontWeight: 'bold' },
    { tag: highlight.tags.operatorKeyword, color: 'deeppink', fontWeight: 'bold' },
    { tag: highlight.tags.definitionKeyword, color: 'deeppink', fontWeight: 'bold' },
    { tag: highlight.tags.name, color: "slateblue" },
    { tag: highlight.tags.brace, color: "hotpink" },
    { tag: highlight.tags.bracket, color: "blue" },
    { tag: highlight.tags.paren, color: "red" },
    { tag: highlight.tags.labelName, color: "purple" },
    { tag: highlight.tags.monospace, fontFamily: "monospace", },
]);
function typst() {
    let parser = new TypstParser(typstHighlight);
    let updateListener = parser.updateListener();
    return new language.LanguageSupport(new language.Language(data, parser, [
        updateListener,
        language.syntaxHighlighting(TypstHighlightSytle)
    ], 'typst'));
}

exports.TypstHighlightSytle = TypstHighlightSytle;
exports.TypstParseContext = TypstParseContext;
exports.TypstParser = TypstParser;
exports.typst = typst;
exports.typstHighlight = typstHighlight;
