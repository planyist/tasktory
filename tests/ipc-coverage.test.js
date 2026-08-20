/**
 * Every IPC method the renderer calls must exist in preload, and must be
 * stubbed in the DOM tests.
 *
 * The stub list is not paperwork. A method missing from it means no test has
 * ever run the code path that calls it - the call would have thrown
 * `is not a function` the moment one did. That is exactly how drag-and-drop
 * shipped broken: `pathForFile` was absent, because the seven attachment tests
 * all called `addAttachments` directly and none of them went through a drop.
 *
 * This file fails when a new IPC method arrives without a test that exercises
 * it, which is the point where the gap is cheap to close.
 */
const fs = require('fs')
const path = require('path')

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8')

const renderer = read('renderer.js')
const preload = read('preload.js')
const domTests = read(path.join('tests', 'renderer-dom.test.js'))

const used = [...new Set(
    [...renderer.matchAll(/window\.electronAPI\.(\w+)/g)].map((m) => m[1])
)].sort()

const keysIndentedBy = (source, spaces) =>
    new Set([...source.matchAll(new RegExp(`^ {${spaces}}(\\w+)\\s*:`, 'gm'))]
        .map((m) => m[1]))

describe('IPC surface', () => {
    test('the renderer calls something', () => {
        expect(used.length).toBeGreaterThan(10)
    })

    test('every method the renderer calls is exposed by preload', () => {
        const exposed = keysIndentedBy(preload, 4)

        expect(used.filter((name) => !exposed.has(name))).toEqual([])
    })

    // Guarded rather than merely listed: a name here with no stub is a code
    // path no test has entered.
    test('every method the renderer calls is stubbed in the DOM tests', () => {
        const stubbed = keysIndentedBy(domTests, 8)

        expect(used.filter((name) => !stubbed.has(name))).toEqual([])
    })
})
