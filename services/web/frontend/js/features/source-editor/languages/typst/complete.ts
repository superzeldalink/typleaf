import { Completion, CompletionContext } from '@codemirror/autocomplete'
import { Folder } from '../../../../../../../types/folder'
import { metadataState } from '../../extensions/language'

const typstCommandCompletions: Completion[] = [
  { label: 'let', type: 'keyword', apply: 'let ' },
  { label: 'set', type: 'keyword', apply: 'set ' },
  { label: 'show', type: 'keyword', apply: 'show ' },
  { label: 'import', type: 'keyword', apply: 'import ""' },
  { label: 'include', type: 'keyword', apply: 'include("")' },
  { label: 'if', type: 'keyword', apply: 'if ' },
  { label: 'else', type: 'keyword', apply: 'else ' },
  { label: 'for', type: 'keyword', apply: 'for ' },
  { label: 'while', type: 'keyword', apply: 'while ' },
  { label: 'break', type: 'keyword', apply: 'break' },
  { label: 'continue', type: 'keyword', apply: 'continue' },
  { label: 'return', type: 'keyword', apply: 'return ' },
  { label: 'context', type: 'keyword', apply: 'context ' },
  { label: 'none', type: 'constant', apply: 'none' },
  { label: 'auto', type: 'constant', apply: 'auto' },
  { label: 'true', type: 'constant', apply: 'true' },
  { label: 'false', type: 'constant', apply: 'false' },
  { label: 'heading', type: 'function', apply: 'heading(' },
  { label: 'text', type: 'function', apply: 'text(' },
  { label: 'align', type: 'function', apply: 'align(' },
  { label: 'figure', type: 'function', apply: 'figure(' },
  { label: 'table', type: 'function', apply: 'table(' },
  { label: 'grid', type: 'function', apply: 'grid(' },
  { label: 'image', type: 'function', apply: 'image(' },
  { label: 'link', type: 'function', apply: 'link(' },
  { label: 'raw', type: 'function', apply: 'raw(' },
  { label: 'box', type: 'function', apply: 'box(' },
  { label: 'stack', type: 'function', apply: 'stack(' },
  { label: 'line', type: 'function', apply: 'line(' },
  { label: 'polygon', type: 'function', apply: 'polygon(' },
  { label: 'circle', type: 'function', apply: 'circle(' },
  { label: 'rect', type: 'function', apply: 'rect(' },
  { label: 'ellipse', type: 'function', apply: 'ellipse(' },
]

function collectProjectTypPaths(folder: Folder, path = ''): string[] {
  const docs = folder.docs
    .filter(doc => doc.name.endsWith('.typ'))
    .map(doc => `${path}${doc.name}`)
  const fileRefs = folder.fileRefs
    .filter(fileRef => fileRef.name.endsWith('.typ'))
    .map(fileRef => `${path}${fileRef.name}`)
  const nested = folder.folders.flatMap(nestedFolder =>
    collectProjectTypPaths(nestedFolder, `${path}${nestedFolder.name}/`)
  )

  return [...docs, ...fileRefs, ...nested]
}

export function typstPathCompletionSource(context: CompletionContext) {
  const pathContext = context.matchBefore(
    /#(?:include|import)\s*(?:\(\s*)?"[^"\n]*$/
  )

  if (!pathContext) {
    return null
  }

  const metadata = context.state.field(metadataState, false)

  if (!metadata?.fileTreeData) {
    return null
  }

  const quoteIndex = pathContext.text.lastIndexOf('"')

  if (quoteIndex === -1) {
    return null
  }

  const from = pathContext.from + quoteIndex + 1
  const typedPath = pathContext.text.slice(quoteIndex + 1)
  const options = collectProjectTypPaths(metadata.fileTreeData)
    .filter(path => path.startsWith(typedPath))
    .map(path => ({
      label: path,
      type: 'file',
    }))

  if (options.length === 0) {
    return null
  }

  return {
    from,
    options,
    validFor: /^[^"\n]*$/,
  }
}

export function typstCommandCompletionSource(context: CompletionContext) {
  const commandContext = context.matchBefore(/#[\w-]*/)

  if (!commandContext) {
    return null
  }

  if (commandContext.from === commandContext.to && !context.explicit) {
    return null
  }

  const typedCommand = commandContext.text.slice(1).toLowerCase()
  const options = typstCommandCompletions.filter(completion =>
    completion.label.toLowerCase().startsWith(typedCommand)
  )

  if (options.length === 0) {
    return null
  }

  return {
    from: commandContext.from + 1,
    options,
    validFor: /^[\w-]*$/,
  }
}
