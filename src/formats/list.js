import Quill from 'quill'
import {
  TableCell,
  TableCellLine,
  CELL_IDENTITY_KEYS,
  CELL_ATTRIBUTES
} from './table'

const ListContainer = Quill.import('formats/list-container')
const ListItem = Quill.import('formats/list')
const Parchment = Quill.import('parchment')

// Jira-style single-tri-state checklist: one list type 'check' with an
// orthogonal data-checked attribute. Parallel to native Quill's 'checked' /
// 'unchecked' pair (two list types, no attribute).
const CheckedAttributor = new Parchment.Attributor('checked', 'data-checked', {
  scope: Parchment.Scope.BLOCK
})

class TableListContainer extends ListContainer {
  static getTag (value) {
    const listValue = typeof value === 'string' ? value : (value && value.value)
    if (listValue === 'bullet' || listValue === 'check') return 'UL'
    return 'OL'
  }

  static create (value) {
    const node = document.createElement(this.getTag(value))
    if (value && typeof value === 'object' && value.row) {
      node.setAttribute('data-row', value.row)
    }
    return node
  }

  static formats (domNode) {
    const formats = {}
    if (domNode.hasAttribute('data-row')) {
      formats.row = domNode.getAttribute('data-row')
    }
    return formats
  }

  formats () {
    const formats = {}
    if (this.domNode.hasAttribute('data-row')) {
      formats.row = this.domNode.getAttribute('data-row')
    }
    return formats
  }

  checkMerge () {
    if (!super.checkMerge()) return false
    if (this.next == null || this.next.children.head == null) return false
    // Same tag only — bullet/check (UL) must not merge with ordered (OL).
    if (this.domNode.tagName !== this.next.domNode.tagName) return false

    const thisRow = this.domNode.getAttribute('data-row')
    const nextRow = this.next.domNode.getAttribute('data-row')
    // Non-cell lists: plain same-tag merge (matches native ListContainer behavior).
    if (!thisRow && !nextRow) return true
    // One side has cell identity, other does not → boundary, don't merge.
    if (!thisRow || !nextRow) return false
    if (thisRow !== nextRow) return false
    const thisTailLi = this.children.tail
    const nextHeadLi = this.next.children.head
    if (!thisTailLi || !nextHeadLi) return false
    const thisId = TableList.identity(thisTailLi.domNode)
    const nextId = TableList.identity(nextHeadLi.domNode)
    if (!thisId.cell || !nextId.cell) return false
    return thisId.cell === nextId.cell
  }
}
TableListContainer.blotName = 'list-container'
TableListContainer.tagName = ['OL', 'UL']
TableListContainer.defaultTag = 'OL'

class TableList extends ListItem {
  static register () {
    // Override the inherited ListItem.register() which would re-register the native
    // ListContainer and clobber our TableListContainer.
    Quill.register(TableListContainer, true)
    Quill.register(CheckedAttributor, true)
  }

  constructor (scroll, domNode) {
    super(scroll, domNode)
    // ListItem constructor attaches a uiNode <span class="ql-ui"> for
    // native checkbox (checked/unchecked) toggling. Tag it for the Jira-style
    // single 'check' type so our CSS can render the checkbox.
    if (domNode.getAttribute('data-list') === 'check') {
      this._applyCheckUi()
    }
  }

  _applyCheckUi () {
    if (this.uiNode) {
      this.uiNode.classList.add('ql-check')
      this.uiNode.setAttribute('contenteditable', 'false')
    }
    if (!this.domNode.hasAttribute('data-checked')) {
      this.domNode.setAttribute('data-checked', 'false')
    }
  }

  _removeCheckUi () {
    if (this.uiNode) this.uiNode.classList.remove('ql-check')
    this.domNode.removeAttribute('data-checked')
  }

  static create (value) {
    if (typeof value === 'string') {
      value = { value }
    }
    const node = super.create(value.value)
    if (value.value === 'check' && !node.hasAttribute('data-checked')) {
      node.setAttribute('data-checked', 'false')
    }
    CELL_IDENTITY_KEYS.forEach(key => {
      if (value[key]) node.setAttribute(`data-${key}`, value[key])
    })
    CELL_ATTRIBUTES.forEach(key => {
      if (value[key]) node.setAttribute(`data-${key}`, value[key])
    })
    if (value['cell-bg']) {
      node.setAttribute('data-cell-bg', value['cell-bg'])
    }
    return node
  }

  // Scalar list type — matches native ListItem.formats shape so Quill's delta/clipboard
  // round-trips work. Fall back to <ul>/<ol> parent tag when data-list is missing
  // (true for freshly pasted HTML).
  static formats (domNode) {
    if (domNode.hasAttribute('data-list')) {
      return domNode.getAttribute('data-list') || undefined
    }
    const parent = domNode.parentNode
    if (parent && parent.tagName === 'UL') return 'bullet'
    if (parent && parent.tagName === 'OL') return 'ordered'
    return undefined
  }

  // Cell-identity on the LI, read directly from DOM. Used by checkMerge, format,
  // optimize, and our own re-wrap logic — separate from the scalar .formats shape.
  static identity (domNode) {
    const out = {}
    CELL_IDENTITY_KEYS.concat(CELL_ATTRIBUTES).concat(['cell-bg']).forEach(attr => {
      if (domNode.hasAttribute(`data-${attr}`)) {
        out[attr] = domNode.getAttribute(`data-${attr}`) || undefined
      }
    })
    return out
  }

  // Return the native ListItem shape (scalar list type) so Quill's delta diffing
  // and bubbleFormats round-trip cleanly. Cell identity is read separately via
  // TableList.identity(domNode) in places that need it (checkMerge, optimize, format).
  formats () {
    const formats = {}
    const listValue = TableList.formats(this.domNode)
    if (listValue !== undefined) formats[TableList.blotName] = listValue
    return formats
  }

  format (name, value) {
    if (name !== TableList.blotName) {
      super.format(name, value)
      return
    }
    if (value) {
      const listValue = typeof value === 'string' ? value : value.value
      if (!listValue) {
        super.format(name, value)
        return
      }
      this.domNode.setAttribute('data-list', listValue)
      if (listValue === 'check') {
        this._applyCheckUi()
      } else {
        this._removeCheckUi()
      }
      if (typeof value === 'object') {
        CELL_IDENTITY_KEYS.concat(CELL_ATTRIBUTES).forEach(key => {
          if (value[key]) this.domNode.setAttribute(`data-${key}`, value[key])
        })
        if (value['cell-bg']) this.domNode.setAttribute('data-cell-bg', value['cell-bg'])
      }
      // Re-wrap into a correctly-tagged container if bullet/check (UL) ↔ ordered (OL)
      // crossed — otherwise the LI stays in a wrong-tag container.
      const desiredTag = TableListContainer.getTag(listValue)
      if (this.parent
        && this.parent.domNode
        && this.parent.domNode.tagName !== desiredTag) {
        const row = TableList.identity(this.domNode).row
        const wrapValue = row ? { row, value: listValue } : { value: listValue }
        this.wrap(TableListContainer.blotName, wrapValue)
      }
      return
    }
    const id = TableList.identity(this.domNode)
    const { row, cell, rowspan, colspan } = id
    const cellBg = id['cell-bg']
    if (row) {
      this.replaceWith(TableCellLine.blotName, {
        row, cell, rowspan, colspan, 'cell-bg': cellBg
      })
    } else {
      super.format(name, value)
    }
  }

  optimize (context) {
    const id = TableList.identity(this.domNode)
    const listValue = TableList.formats(this.domNode)
    const { row, rowspan, colspan } = id

    // Pre-empt ParentBlot.optimize's valueless wrap: pass the list value so
    // TableListContainer.create picks the correct UL/OL tag.
    if (!(this.parent instanceof TableListContainer)) {
      const wrapValue = row ? { row, value: listValue } : { value: listValue }
      this.wrap(TableListContainer.blotName, wrapValue)
    }

    if (row && this.parent && this.parent.parent && !(this.parent.parent instanceof TableCell)) {
      this.parent.wrap(TableCell.blotName, { row, rowspan, colspan })
    }

    super.optimize(context)
  }
}
TableList.blotName = 'list'
TableList.tagName = 'LI'

TableListContainer.allowedChildren = [TableList]
TableList.requiredContainer = TableListContainer

export { TableListContainer, TableList, CheckedAttributor }
