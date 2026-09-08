import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { rootCertificates } from 'node:tls'
import { test } from 'node:test'

test('bundled intermediate is a valid CA signed by an existing Node trusted root', async () => {
  const pem = await readFile(new URL('../certificates/sectigo-ov-r36.pem', import.meta.url), 'utf8')
  assert.equal(pem.match(/-----BEGIN CERTIFICATE-----/g)?.length, 1)
  const certificate = new X509Certificate(pem)
  assert.ok(certificate.ca)
  assert.equal(certificate.fingerprint256, '65:42:D1:76:BE:D5:0F:19:3C:0C:E2:97:AE:44:EC:D8:A0:A8:6B:EC:2E:DE:68:27:69:34:40:59:B4:E7:85:30')
  const root = rootCertificates.map(pem => new X509Certificate(pem))
    .find(root => certificate.checkIssued(root) && certificate.verify(root.publicKey))
  assert.ok(root, 'The intermediate must chain to a root already trusted by Node.')
  for (const cert of [certificate, root]) {
    assert.ok(Date.parse(cert.validFrom) <= Date.now(), 'Certificate is not valid yet.')
    assert.ok(Date.parse(cert.validTo) > Date.now(), 'Certificate expired; review the source chain.')
  }
})
