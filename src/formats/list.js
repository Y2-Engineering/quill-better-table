import Quill from 'quill'
import {
  TableCell,
  TableCellLine,
  CELL_IDENTITY_KEYS,
  CELL_ATTRIBUTES
} from './table'

const ListContainer = Quill.import('formats/list-container')
const ListItem = Quill.import('formats/list')

class TableListContainer extends ListContainer {
  static create (value) {
    const node = super.create(value)
    if (value && value.row) {
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
    const thisRow = this.domNode.getAttribute('data-row')
    const nextRow = this.next.domNode.getAttribute('data-row')
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
TableListContainer.tagName = 'OL'

class TableList extends ListItem {
  static register () {
    // Override the inherited ListItem.register() which would re-register the native
    // ListContainer and clobber our TableListContainer.
    Quill.register(TableListContainer, true)
  }

  static create (value) {
    if (typeof value === 'string') {
      value = { value }
    }
    const node = super.create(value.value)
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
      if (typeof value === 'object') {
        CELL_IDENTITY_KEYS.concat(CELL_ATTRIBUTES).forEach(key => {
          if (value[key]) this.domNode.setAttribute(`data-${key}`, value[key])
        })
        if (value['cell-bg']) this.domNode.setAttribute('data-cell-bg', value['cell-bg'])
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
    const { row, rowspan, colspan } = id

    if (row && !(this.parent instanceof TableListContainer)) {
      this.wrap(TableListContainer.blotName, { row })
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

export { TableListContainer, TableList }
