import type { ElementConstructor, EngineInterface, InputProps } from 'claude-code'

import { THEME_COLORS } from '../../shared/style'
import { cellWidth } from '../../shared/text-width'
import { addTodoFromField, clearDoneTodos, cycleTodo, deleteTodo, editFieldKey, offerTodo, saveEditFromField, startEditTodo, undoDelete } from '../../todo/todo'
import { oneLine, rowTailCells, showsTurn, STATUS_MARK } from '../../todo/todo-format'
import { acceptTodoSuggestion, rejectTodoSuggestion } from '../../todo/todo-judge'
import type { TodoSuggestion } from '../../todo/todo-judge-format'
import type { UserTodo } from '../../todo/todo-format'
import { clipCells } from '../sidebar-format'
import type { Frame } from './frame'

export type TodoDrawing = {
  /** Every to-do in the order shown, and as many of them as the rows hold. */
  items: readonly UserTodo[]
  shown: readonly UserTodo[]
  /** The item the field edits, null while none. */
  edited: UserTodo | null
  /** The field the tab writes with: absent where the surface draws none (mobile). */
  Input: ElementConstructor<InputProps> | undefined
  doneCount: number
  /** The items "↶ 되돌리기" brings back; 0, no button. */
  undoN: number
  /** A judgment put to the person: the item a question seems to start, or an answer to finish; null while none. */
  suggested: TodoSuggestion | null
}

/**
 * The to-dos: in progress, waiting, on hold, done, as many as the rows hold (twelve at most) and
 * "외 N개"; under them a judgment's "시작? …" or "완료? …" with 맞음 and 아님 (its item marked like an
 * edited one), "완료 N개 지우기", "↶ 되돌리기" after a delete, and the field that writes one
 * (or edits the item whose text was pressed, that row marked). `$` only on a press.
 */
export function todoBody($: EngineInterface, f: Frame, d: TodoDrawing): JSX.Element {
  const { Box, Text, Button } = f.parts
  const { items: userTodos, shown: shownTodos, edited, Input, doneCount, undoN, suggested } = d
  const hasField = Input !== undefined
  const inner = f.inner

  const todoRow = (item: UserTodo) => {
    // The item a suggestion is about is marked as the edited one is: the line below says what is asked of it.
    const isEdited = edited?.id === item.id || suggested?.id === item.id
    const isDim = !isEdited && (item.status === 'done' || item.status === 'on_hold')
    const mark = STATUS_MARK[item.status]
    // The sign (an emoji, two cells), a space, the text; then a cell at least before the tail.
    const room = inner - cellWidth(`${mark} `) - rowTailCells(item) - 1
    const text = (
      <Text {...(isEdited ? { bold: true, color: THEME_COLORS.effort } : isDim ? { dimColor: true } : {})}>{` ${clipCells(oneLine(item.text), room)}`}</Text>
    )

    // ↗ and ✕ hold a space each side, three cells to press, the sign in the middle of the focus mark.
    return (
      <Box key={`todo-${item.id}`} justifyContent="space-between">
        <Box>
          {/* A press moves it on: waiting, in progress, done, on hold, waiting. An emoji keeps its colours: no dim, no theme colour. */}
          <Button
            key={`todo-status-${item.id}`}
            plain
            onPress={() => {
              void cycleTodo($, item.id)
            }}
          >
            <Text>{mark}</Text>
          </Button>
          {/* A press on the text edits it in the field below; no field (mobile), no press. */}
          {hasField ? (
            <Button
              key={`todo-text-${item.id}`}
              plain
              onPress={() => {
                void startEditTodo($, item.id)
              }}
            >
              {text}
            </Button>
          ) : (
            text
          )}
        </Box>
        <Box>
          {showsTurn(item) ? <Text dimColor>{` #${item.turn}`}</Text> : null}
          {item.status === 'pending' ? (
            <Button
              key={`todo-send-${item.id}`}
              plain
              onPress={() => {
                void offerTodo($, item)
              }}
            >
              <Text color={THEME_COLORS.effort}> ↗ </Text>
            </Button>
          ) : null}
          <Button
            key={`todo-delete-${item.id}`}
            plain
            onPress={() => {
              void deleteTodo($, item.id)
            }}
          >
            <Text dimColor> ✕ </Text>
          </Button>
        </Box>
      </Box>
    )
  }

  // "시작? 내용…  82%  맞음  아님": the status moves on 맞음 alone. The buttons three cells and a space each side, as ↗ and ✕.
  const suggestionRow = (shown: TodoSuggestion) => {
    const percent = ` ${Math.round(shown.probability * 100)}%`
    const head = shown.kind === 'take' ? '시작? ' : '완료? '
    const room = inner - cellWidth(head) - cellWidth(percent) - cellWidth(' 맞음  아님 ') - 1

    return (
      <Box key="todo-suggestion" justifyContent="space-between">
        <Text color={THEME_COLORS.effort}>{`${head}${clipCells(oneLine(shown.text), room)}`}</Text>
        <Box>
          <Text dimColor>{percent}</Text>
          <Button
            key="todo-suggestion-yes"
            plain
            onPress={() => {
              void acceptTodoSuggestion($)
            }}
          >
            <Text color={THEME_COLORS.effort}> 맞음 </Text>
          </Button>
          <Button
            key="todo-suggestion-no"
            plain
            onPress={() => {
              void rejectTodoSuggestion($)
            }}
          >
            <Text dimColor> 아님 </Text>
          </Button>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {userTodos.length === 0 ? <Text dimColor>적어 둔 할 일이 없습니다</Text> : null}
      {shownTodos.map(todoRow)}
      {userTodos.length > shownTodos.length ? (
        <Text key="todo-more" dimColor>
          {`외 ${userTodos.length - shownTodos.length}개`}
        </Text>
      ) : null}
      {suggested === null ? null : suggestionRow(suggested)}
      {doneCount > 0 ? (
        <Button
          key="todo-clear-done"
          plain
          onPress={() => {
            void clearDoneTodos($)
          }}
        >
          <Text dimColor>{`완료 ${doneCount}개 지우기`}</Text>
        </Button>
      ) : null}
      {undoN > 0 ? (
        <Button
          key="todo-undo"
          plain
          onPress={() => {
            void undoDelete($)
          }}
        >
          <Text color={THEME_COLORS.effort}>{`↶ 되돌리기 (${undoN}개)`}</Text>
        </Button>
      ) : null}
      {/* Enter writes it; the engine empties the field after. Editing, a field of its own holds the
          item's text: Enter saves, empty cancels, and so does the pane letting the keyboard go (Esc). */}
      {Input === undefined ? null : edited !== null ? (
        <Input
          key={editFieldKey()}
          label="수정 중 "
          value={edited.text}
          placeholder="비우고 Enter면 취소"
          submitLabel="저장"
          onSubmit={value => {
            void saveEditFromField($, edited.id, value)
          }}
        />
      ) : (
        <Input
          key="todo-input"
          placeholder="할 일 적기"
          submitLabel="추가"
          onSubmit={value => {
            void addTodoFromField($, value)
          }}
        />
      )}
    </Box>
  )
}
