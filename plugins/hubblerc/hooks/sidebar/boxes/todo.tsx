import type { ElementConstructor, EngineInterface, InputProps } from 'claude-code'

import { THEME_COLORS } from '../../shared/style'
import { cellWidth } from '../../shared/text-width'
import { ADD_FIELD_KEY, addFieldDrawnValue, addTodoFromField, clearDoneTodos, cycleTodo, deleteTodo, editFieldKey, noteFieldText, offerTodo, saveEditFromField, startEditTodo, undoDelete } from '../../todo/todo'
import { DETAIL_MARK, editText, oneLine, rowTailCells, rowTitle, showsTurn, STATUS_MARK, TODO_FIELDS } from '../../todo/todo-format'
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
 * edited one), "완료 N개 지우기" and "↶ 되돌리기" after a delete. The field is `todoField`'s, under the
 * box. `$` only on a press.
 */
export function todoBody($: EngineInterface, f: Frame, d: TodoDrawing): JSX.Element {
  const { Box, Text, Button } = f.parts
  const { items: userTodos, shown: shownTodos, edited, Input, doneCount, undoN, suggested } = d
  const hasField = Input !== undefined
  const inner = f.openInner

  const todoRow = (item: UserTodo) => {
    // The item a suggestion is about is marked as the edited one is: the line below says what is asked of it.
    const isEdited = edited?.id === item.id || suggested?.id === item.id
    const isDim = !isEdited && (item.status === 'done' || item.status === 'on_hold')
    const mark = STATUS_MARK[item.status]
    // The sign (an emoji, two cells), the id dim, the text, each after a space; then a cell at least before the tail.
    const idText = ` ${item.id}`
    const room = inner - cellWidth(mark) - cellWidth(idText) - 1 - rowTailCells(item) - 1
    const text = (
      <Text {...(isEdited ? { bold: true, color: THEME_COLORS.effort } : isDim ? { dimColor: true } : {})}>{` ${rowTitle(item, room)}`}</Text>
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
          {/* The id, outside the press: the number `/todo 수정` and the tool name it by. */}
          <Text dimColor>{idText}</Text>
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
          {item.detail === undefined ? null : <Text dimColor>{DETAIL_MARK}</Text>}
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
    </Box>
  )
}

/**
 * The field under the box that writes an item, or edits the item whose text was pressed (that row
 * marked in the box). Drawn outside the box, as wide as the pane: the terminal's engine wraps and
 * scrolls a field's text at the pane's columns whatever holds it, so inside the box's frame its last
 * four cells, the caret's among them, were cut off (2026-11-16, on screen; engine 2.1.325 read).
 * Enter writes it, the first line the title and the lines after it (Shift+Enter) the detail; the
 * field is emptied by drawing it with another value (`addFieldDrawnValue`). Editing, a field of its
 * own holds the title and the detail under it: Enter saves, empty cancels, and so does the pane
 * letting the keyboard go (Esc). Either grows a row as its text wraps. `$` only on a change or Enter.
 */
export function todoField($: EngineInterface, d: { Input: ElementConstructor<InputProps>; edited: UserTodo | null; rows: number; columns: number }): JSX.Element {
  const { Input, edited, rows, columns } = d

  return edited !== null ? (
    <Input
      key={editFieldKey()}
      label={TODO_FIELDS.edit.label}
      value={editText(edited)}
      rows={rows}
      placeholder="비우고 Enter면 취소"
      submitLabel={TODO_FIELDS.edit.submitLabel}
      onInput={value => {
        void noteFieldText($, editFieldKey(), 'edit', value, columns, rows)
      }}
      onSubmit={value => {
        void saveEditFromField($, edited.id, value)
      }}
    />
  ) : (
    <Input
      key={ADD_FIELD_KEY}
      {...(addFieldDrawnValue() === undefined ? {} : { value: '' })}
      rows={rows}
      placeholder="할 일 적기"
      submitLabel={TODO_FIELDS.add.submitLabel}
      onInput={value => {
        void noteFieldText($, ADD_FIELD_KEY, 'add', value, columns, rows)
      }}
      onSubmit={value => {
        void addTodoFromField($, value)
      }}
    />
  )
}
