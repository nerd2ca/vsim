var configInput = {
    oninit: function(vnode) {
        var v = vnode.attrs.stream()
        this.str = '' + (vnode.attrs.pct ? Math.round(v*100) : v)
    },
    view: function(vnode) {
        var state = this
        var simstate = vnode.attrs.simstate
        var step = 1
        for (var i=0; i<vnode.attrs.decimals; i++)
            step = step/10
        return m('.', [
            vnode.attrs.label,
            m('br'),
            m('input[type=number]', {
                title: vnode.attrs.hint,
                style: {width: '100%'},
                value: state.str,
                step: step,
                oninput: function(e) {
                    state.str = e.target.value
                    vnode.attrs.stream(parseFloat(state.str) * (vnode.attrs.pct ? 0.01 : 1))
                },
            }),
        ])
    },
}

var P = {
    oninit: function(Pnode) {
        this.scenario = Pnode.attrs.store.scenario.map((s) => Object.assign({}, Pnode.attrs.store.params, s, {person: []}))
        this.elements = {}
        this.series = {}
        this.today = 0
        var palette = new Rickshaw.Color.Palette({scheme: 'spectrum14'});
        for (var scenario=0; scenario<this.scenario.length; scenario++)
            ['cases', 'icu', 'deaths'].forEach((seriesKey, seriesIdx) => {
                var scenarioName = `scenario ${(scenario+10).toString(16).toUpperCase()}`
                var seriesName = `${scenarioName}: ${seriesKey}`
                var what = ({
                    cases: 'new cases detected today',
                    deaths: 'new deaths today',
                    icu: 'patients in ICU beds today',
                })[seriesKey]
                this.series[seriesKey+scenario] = {
                    name: seriesName,
                    data: [],
                    scale: d3.scale.linear().domain([-2, 100]),
                    xdate: (x) => {
                        var d = new Date()
                        d.setDate(d.getDate() + x)
                        return d.toDateString()
                    },
                    xFormatter: (x) => {
                        return `${x}d`
                    },
                    formatter: (series, x, y) => {
                        return `${scenarioName}<br>day ${x}<br>${Math.round(y)} ${what}`
                    },
                    color: palette.color(scenario*6+seriesIdx),
                }
            })
        this.series.dummy = {
            name: "",
            data: [
                {x:0,y:-100},
                {x:this.scenario[0].days(),y:-100},
            ],
        }
        this.scenario[0].days.map((d) => {
            this.series.dummy.data[1].x = d
        })
        window.addEventListener("resize", (e) => {
            m.redraw()
            if (!this.graph)
                return
            this.graph.setSize()
            this.xaxis.setSize()
            this.yaxis.setSize()
            this.graph.render()
        })
        var allstreams = []
        this.scenario.forEach((s) => {
            Object.values(s).forEach((p) => {
                if (0 in p)
                    Object.values(p).forEach((p) => {
                        allstreams.push(p)
                    })
                else if (p.constructor === m.stream) {
                    allstreams.push(p)
                }
            })
        })
        m.stream.combine(function(){}, allstreams).map(() => {
            this.today = 0
            this.runSimulation()
        })
    },
    setup: function() {
        if (!(this.elements.graph && this.elements.axisx && this.elements.axisy && this.elements.legend))
            return null
        this.graph = new Rickshaw.Graph({
            element: this.elements.graph,
            renderer: "line",
            series: [
                this.series.dummy,
                this.series.deaths1, this.series.icu1, this.series.cases1,
                this.series.deaths0, this.series.icu0, this.series.cases0,
            ],
        })
        var hoverDetail = new Rickshaw.Graph.HoverDetail({
            graph: this.graph,
            formatter: function(series,x,y) { if (series.formatter) return series.formatter(series,x,y) },
            xFormatter: function(series,x,y) { if (series.formatter) return series.xFormatter(series,x,y) },
        })
        var legend = new Rickshaw.Graph.Legend({
            graph: this.graph,
            element: this.elements.legend,
        })
        this.yaxis = new Rickshaw.Graph.Axis.Y.Scaled({
            element: this.elements.axisy,
            graph: this.graph,
            orientation: 'left',
            scale: this.series.cases0.scale,
        });
        this.xaxis = new Rickshaw.Graph.Axis.X({
            element: this.elements.axisx,
            graph: this.graph,
            orientation: 'bottom',
            ticks: 10,
            tickFormat: this.series.cases0.xFormatter,
        });
        this.graph.render()
    },
    infect: function(pp, x, scenario, fade) {
        var duration = Math.ceil(randn_bm()*scenario.infectionDuration()*2)
        pp.infected = x
        pp.detected = x + Math.floor(duration / 2)
        if (Math.random() < scenario.deathRate() * (1 - fade * scenario.vaccineDeathEff[pp.vaccine]()))
            pp.dead = x + duration
        else
            pp.recovered = x + duration
        if (Math.random() < scenario.icuRate() * (1 - fade * scenario.vaccineIcuEff[pp.vaccine]()))
            pp.icu = x + Math.ceil(duration / 2)
        else
            pp.icu = null
    },
    runSimulation: function() {
        var starttime = new Date().getTime()
        this.scenario.forEach(this.runScenario, this)

        var max = 1
        Object.values(this.series).forEach((series) => {
            series.data.forEach((pt) => {
                if (max < pt.y) max = pt.y
            })
        })
        Object.values(this.series).forEach((series) => {
            series.scale = d3.scale.linear().domain([-2, max])
        })

        if (this.today < this.scenario[0].days()) {
            this.today++
            window.setTimeout(() => {
                this.runSimulation()
                if (this.yaxis)
                    this.yaxis.scale = d3.scale.linear().domain([-2, max])
                if (this.graph)
                    this.graph.render()
            }, (new Date().getTime() - starttime))
        }
    },
    runScenario: function(store, scenarioIdx) {
        if (this.today == 0) {
            this.series['cases'+scenarioIdx].data.splice(this.scenario[0].days())
            this.series['icu'+scenarioIdx].data.splice(this.scenario[0].days())
            this.series['deaths'+scenarioIdx].data.splice(this.scenario[0].days())
            store.person.splice(0)
            for (var p=0; p<store.population(); p++) {
                store.person[p] = {
                    vaccine: (Math.random() < store.vaccineRate()) ? 1 : 0,
                }
            }
            for (var p=0; p<store.infected0(); p++) {
                this.infect(store.person[Math.floor(Math.random()*store.population())], 0, store, 1)
            }
        }
        var x = this.today
        var cases = 0
        var icu = 0
        var deaths = 0
        var dailyR0 = store.R0() / store.infectionDuration()
        for (var p in store.person) {
            var pp = store.person[p]
            if (pp.dead == x)
                deaths++
            if (!(pp.dead >= x)) {
                if (pp.detected == x)
                    cases++
                if (pp.icu !== null && pp.icu <= x && !(pp.recovered <= x))
                    icu++
                if (pp.infected <= x && !(pp.recovered < x || pp.dead < x)) {
                    if (Math.random() < dailyR0) {
                        var p2 = Math.floor(Math.random() * store.population())
                        var pp2 = store.person[p2]
                        var fade = Math.pow(0.5, x / store.vaccineHalflife[pp.vaccine]())
                        var fade2 = Math.pow(0.5, x / store.vaccineHalflife[pp2.vaccine]())
                        if (!(pp2.infected <= x && (pp2.recovered >= x || pp2.dead >= x)) &&
                            Math.random() < (1 - fade * store.vaccineTransmitEff[pp.vaccine]()) * (1 - fade2 * store.vaccineInfectEff[pp2.vaccine]())) {
                            this.infect(pp2, x, store, fade2)
                        }
                    }
                }
            }
        }
        this.series['cases'+scenarioIdx].data[x] = {x:x,y:cases}
        this.series['icu'+scenarioIdx].data[x] = {x:x,y:icu}
        this.series['deaths'+scenarioIdx].data[x] = {x:x,y:deaths}
    },
    view: function(Pnode) {
        var elements = this.elements
        return m('.container-fluid', [
            ['scenario A', 'scenario B'].map((label, scenario) => {
                return m('.row', [
                    m('.col-1', m('.', {style: {height: '1.5em'}}), label),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].infected0, label: ['infections', m('sub', '0')], hint: 'initial number of infections on day 0'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].R0, label: ['R', m('sub', '0')], decimals: 2, hint: 'average transmissions per case (unvaccinated baseline)'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].infectionDuration, label: 'infected.days', hint: 'average time to recover/die from infection'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].icuRate, label: 'icu%', pct: true, hint: '% infected people who need ICU beds'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].deathRate, label: 'death%', pct: true, hint: '% infected people who die'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].vaccineRate, label: 'vaccinated%', pct: true, hint: '% population vaccinated'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].vaccineInfectEff[1], label: 'vacc.prot.inf%', pct: true, hint: 'vaccine effectiveness at preventing infection'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].vaccineTransmitEff[1], label: 'vacc.prot.trans%', pct: true, hint: 'vaccine effectiveness at reducing contagiousness, once infected'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].vaccineIcuEff[1], label: 'vacc.prot.icu%', pct: true, hint: 'vaccine effectiveness at preventing severe symptoms / need for an ICU bed, once infected'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].vaccineDeathEff[1], label: 'vacc.prot.death%', pct: true, hint: 'vaccine effectiveness at preventing death, once infected'})),
                    m('.col-1', m(configInput, {stream: this.scenario[scenario].vaccineHalflife[1], label: 'vacc.halflife', hint: 'days vaccine takes to fade to 1/2 effectiveness'})),
                ])
            }),
            m('.row', {style: {height: '70%'}}, [
                m('.col-1.h-100', {
                    style: {padding: '0'},
                    oncreate: (vnode) => { elements.axisy = vnode.dom; this.setup() },
                }),
                m('.col-9.h-100', {
                    style: {padding: '0'},
                    oncreate: (vnode) => { elements.graph = vnode.dom; this.setup() },
                }),
                m('.', {style: {padding: '0 0 0 0.5em', overflow: 'hidden', position: 'relative'}}, [
                    m('#legend', {
                        oncreate: (vnode) => { elements.legend = vnode.dom; this.setup() },
                    }),
                ]),
            ]),
            m('.row', {style: {height: '10%'}}, [
                m('.col-1.h-100'),
                m('.col-9.h-100', {
                    style: {padding: '0'},
                    oncreate: (vnode) => { elements.axisx = vnode.dom; this.setup() },
                }),
            ]),
        ])
    },
}

var Page = {
    oninit: function(vnode) {
        this.store = {
            params: {
                population: m.stream(100000),
                days: m.stream(180),
            },
            scenario: [0.65, 0.75].map((vr) => { return {
                infected0: m.stream(100),
                R0: m.stream(2),
                infectionDuration: m.stream(14),
                icuRate: m.stream(0.04),
                deathRate: m.stream(0.02),
                vaccineInfectEff: {
                    0: m.stream(0),
                    1: m.stream(0.5),
                },
                vaccineTransmitEff: {
                    0: m.stream(0),
                    1: m.stream(0.5),
                },
                vaccineIcuEff: {
                    0: m.stream(0),
                    1: m.stream(0.6),
                },
                vaccineDeathEff: {
                    0: m.stream(0),
                    1: m.stream(0.8),
                },
                vaccineHalflife: {
                    0: m.stream(1),
                    1: m.stream(365),
                },
                vaccineRate: m.stream(vr),
            }}),
        }
    },
    view: function(vnode) {
        return m('.container-fluid', {style: {fontSize: '0.7rem'}}, [
            m('.row', {style: {height: '5%'}}, [
                m('.col-12', [
                    m('h3.text-center', 'virus simulator*'),
                ]),
            ]),
            m('.row', [
                m('.col-1', m(configInput, {stream: this.store.params.population, label: 'population'})),
                m('.col-1', m(configInput, {stream: this.store.params.days, label: 'days'})),
            ]),
            m('.row', {style: {height: '80%'}}, [
                m(P, {store: this.store}),
            ]),
            m('.row', {style: {height: '5%'}}, [
                m('.col-12', [
                    m('p.text-center', {style: {fontSize: '0.8rem', fontStyle: 'italic'}}, '* for entertainment purposes only'),
                ]),
            ]),
        ])
    },
}

m.mount(document.body, Page)

// https://stackoverflow.com/questions/25582882/javascript-math-random-normal-distribution-gaussian-bell-curve
function randn_bm() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    num = num / 10.0 + 0.5; // Translate to 0 -> 1
    if (num > 1 || num < 0) return randn_bm() // resample between 0 and 1
    return num
}