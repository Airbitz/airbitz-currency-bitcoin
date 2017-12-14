// @flow

import type { ParsedTx } from '../src/engine/parseTransaction.js'
import { parseTransaction } from '../src/engine/parseTransaction.js'

import { describe, it } from 'mocha'
import { expect } from 'chai'

describe('parseTransaction', function () {
  it('Matches a known transaction', function () {
    // txid 98b83856161f16f877194e0d80167bff0eb853fda89c2401ca2d99ee4676eca2
    const txData =
      '0100000001e7a4a70f71e090157bc7c1b47ee83af56beb3579d8fa24110a97d1ee717d9afb010000006b483045022100de863ece760a873d673851f9c81ed148519dfc237d3fd7d43600896d5c5ba651022003e1620cdbbca12596a34fc97495486eb3f8f523453cb031ac531d623af4c7430121038600604184c04d944cd711e08a903043961a8a01d32e738beec1937dea75ae35ffffffff0277060000000000001976a91491c5eab4339b77e897005c3fcf0c123c62fccf9988ac53150000000000001976a914f783b9f78fe45bae833babfa5f2ebf10dd0cb79788ac00000000'
    const expected: ParsedTx = {
      inputs: [
        {
          txid:
            'fb9a7d71eed1970a1124fad87935eb6bf53ae87eb4c1c77b1590e0710fa7a4e7',
          index: 1
        }
      ],
      outputs: [
        {
          // displayAddress: '1EHn5KN3P71xTsZseTnNCRjfBhPCdw5To4'
          scriptHash:
            'b44600cd86fe9aa07b69417c81b8e59bd26a6965cba19882b9c7b001b98df1fa',
          value: 1655
        },
        {
          // displayAddress: '1PZjhtvQHmUgtoqcNTri7jn2NBq3d5QhBj'
          scriptHash:
            '052c80d8ec3d76cabca31765e54ee5bcce26125a459ce10f1775d0608f203463',
          value: 5459
        }
      ]
    }

    expect(parseTransaction(txData)).to.deep.equal(expected)
  })
})
