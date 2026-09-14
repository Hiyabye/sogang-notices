import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { rootCertificates } from 'node:tls'
import { test } from 'node:test'

test('the command-scoped bundle contains only the two verified CA intermediates signed by Node trusted roots', async () => {
  const pem = await readFile(new URL('../certificates/sogang-intermediates.pem', import.meta.url), 'utf8')
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []
  assert.equal(blocks.length, 2)
  assert.equal(pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '').trim(), '')
  const fingerprints = [
    '65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30',
    'B5:28:67:96:DA:DF:16:52:1D:E4:17:72:AB:2F:DB:58:18:72:99:71:B5:27:47:21:14:6C:6E:81:72:BE:FE:07',
  ]
  for (const [index, block] of blocks.entries()) {
    const certificate = new X509Certificate(block)
    assert.ok(certificate.ca)
    assert.equal(certificate.fingerprint256, fingerprints[index])
    const root = rootCertificates.map(pem => new X509Certificate(pem))
      .find(root => certificate.checkIssued(root) && certificate.verify(root.publicKey))
    assert.ok(root, 'Each intermediate must chain to a root already trusted by Node.')
    for (const cert of [certificate, root]) {
      assert.ok(Date.parse(cert.validFrom) <= Date.now(), 'Certificate is not valid yet.')
      assert.ok(Date.parse(cert.validTo) > Date.now(), 'Certificate expired; review the source chain.')
    }
  }
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.scripts.collect, 'NODE_EXTRA_CA_CERTS=certificates/sogang-intermediates.pem node collect.mjs')
})
