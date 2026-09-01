/**
 * Prometheus 텍스트 노출 형식(0.0.4)을 만드는 **최소 렌더러**.
 *
 * 라이브러리(`prom-client`)를 쓰지 않는 이유는 노출 대상이 게이지 **두 개**뿐이고
 * (histogram·summary·exemplar 없음) 형식이 `name{tag="v"} value` 세 줄짜리이기 때문이다 —
 * ADR-0003의 기조(작은 표면에는 의존성을 늘리지 않는다: ORM·NestJS를 뺀 것과 같은 이유)를
 * 따른다. 계약은 **이름·태그**이므로(docs/design/operations.md 「모니터링」) 렌더러가
 * 무엇이든 스크레이퍼가 보는 것은 같다.
 *
 * 나중에 지연 히스토그램처럼 집계가 필요한 계측이 생기면 그때 `prom-client`를 별도
 * 티켓으로 도입한다 — 그 시점엔 이 파일이 대체된다.
 */

/** 스크레이퍼가 기대하는 Content-Type. 이걸 빼면 Prometheus가 본문을 파싱하지 않는다. */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8'

export interface GaugeSample {
  /** 태그. 값은 계약대로 그대로 싣는다(게임 코드는 대문자). */
  readonly labels?: Readonly<Record<string, string>>
  readonly value: number
}

export interface GaugeFamily {
  /** 노출 이름 — `yorr_rooms_active` 같은 스네이크 표기. */
  readonly name: string
  readonly help: string
  /** 태그 조합별 한 줄. 값이 0인 조합도 **생략하지 않는다**(대시보드에서 계열이 사라진다). */
  readonly samples: readonly GaugeSample[]
}

const escapeHelp = (text: string): string => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')

const escapeLabelValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

const renderLabels = (labels: Readonly<Record<string, string>> | undefined): string => {
  const entries = Object.entries(labels ?? {})
  if (entries.length === 0) return ''
  return `{${entries.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`
}

/** 게이지는 정수만 다루지만, 형식상 비정상 값도 표현이 정해져 있다. */
const renderValue = (value: number): string => {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Number.POSITIVE_INFINITY) return '+Inf'
  if (value === Number.NEGATIVE_INFINITY) return '-Inf'
  return String(value)
}

/** `# HELP`·`# TYPE` 헤더를 포함한 노출 본문. 마지막 줄에도 개행이 붙는다. */
export const renderGauges = (families: readonly GaugeFamily[]): string => {
  const lines: string[] = []
  for (const family of families) {
    lines.push(`# HELP ${family.name} ${escapeHelp(family.help)}`)
    lines.push(`# TYPE ${family.name} gauge`)
    for (const sample of family.samples) {
      lines.push(`${family.name}${renderLabels(sample.labels)} ${renderValue(sample.value)}`)
    }
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}
