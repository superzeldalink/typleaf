import { startCompletion } from '@codemirror/autocomplete'
import { Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { openContextMenuAnnotation } from '../../extensions/context-menu'

const typstCompletionTrigger = /(?:#[\w-]*|#(?:include|import)\s*(?:\(\s*)?"[^"\n]*)$/

export const openAutocomplete = () => {
  return EditorView.updateListener.of(update => {
    if (!update.selectionSet && !update.docChanged) {
      return
    }

    if (
      update.transactions.some(
        transaction =>
          transaction.annotation(Transaction.remote) ||
          transaction.annotation(openContextMenuAnnotation)
      )
    ) {
      return
    }

    const cursor = update.state.selection.main

    if (!cursor.empty) {
      return
    }

    const line = update.state.doc.lineAt(cursor.head)
    const textBeforeCursor = line.text.slice(0, cursor.head - line.from)

    if (typstCompletionTrigger.test(textBeforeCursor)) {
      startCompletion(update.view)
    }
  })
}
