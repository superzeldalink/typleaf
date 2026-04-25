import { CompletionSource } from '@codemirror/autocomplete'
import { LanguageSupport } from '@codemirror/language'
import { typst as typstLanguage } from './vendor/dist/index.js'
import {
  typstCommandCompletionSource,
  typstPathCompletionSource,
} from './complete'

const completionSources: CompletionSource[] = [
  typstPathCompletionSource,
  typstCommandCompletionSource,
]

export const typst = () => {
  const support = typstLanguage()

  return new LanguageSupport(support.language, [
    support.support,
    ...completionSources.map(completionSource =>
      support.language.data.of({
        autocomplete: completionSource,
      })
    ),
  ])
}
