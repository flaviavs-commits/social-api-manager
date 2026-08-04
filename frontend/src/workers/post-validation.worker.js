import { buildValidationIssues } from '../lib/postValidation.js'

self.onmessage = ({ data }) => {
  self.postMessage({ requestId: data.requestId, issues: buildValidationIssues(data) })
}
