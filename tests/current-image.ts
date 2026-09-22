import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chooseCurrentImageIndex} from '../src/collector/current-image.ts';

const urls = [
    'https://sns-img-bd.xhscdn.com/a.jpg?sign=1',
    'https://p3.douyinpic.com/img/b.jpg?sign=2',
    'https://p3.douyinpic.com/img/c.jpg?sign=3',
];

test('current image prefers an active slide data index', () => {
    assert.equal(chooseCurrentImageIndex([
        {order: 0, visible: true, active: false, explicitIndex: 0},
        {order: 1, visible: true, active: true, explicitIndex: 2},
    ], urls), 2);
});

test('current image matches the active DOM URL despite signed query strings', () => {
    assert.equal(chooseCurrentImageIndex([
        {order: 0, visible: true, active: false, source: 'https://p3.douyinpic.com/img/a.jpg'},
        {order: 1, visible: true, active: true, source: 'https://p3.douyinpic.com/img/b.jpg?different=signature'},
    ], urls), 1);
});

test('current image uses the centered visible image when no active marker exists', () => {
    assert.equal(chooseCurrentImageIndex([
        {order: 0, visible: true, distance: 240},
        {order: 1, visible: true, distance: 12},
        {order: 2, visible: false, distance: 0},
    ], urls), 1);
});

test('ambiguous visible images fail closed instead of guessing', () => {
    assert.equal(chooseCurrentImageIndex([
        {order: 0, visible: true, distance: 12},
        {order: 1, visible: true, distance: 12},
    ], urls), undefined);
});

test('a single-image post resolves without DOM evidence', () => {
    assert.equal(chooseCurrentImageIndex([], [urls[0]]), 0);
});
