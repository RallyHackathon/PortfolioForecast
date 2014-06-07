var Lumenize = require('./lumenize')
var NOW = new Date();

Ext.define('Rally.ui.tree.PortfolioForecastTree', {
    extend: 'Rally.ui.tree.PortfolioTree',
    alias: 'widget.portfolioforecasttree',

    handleParentItemStoreLoad: function(store, records) {
        this.callParent(arguments);
    },

    handleChildItemStoreLoad: function(store, records, parentTreeItem) {
        this.callParent(arguments);
    },

    treeItemConfigForRecordFn: function(record) {
        return { xtype: 'rallytreeitem' }
    }
});

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {
        this.add({
            xtype: 'fieldset',
            title: 'Portfolio items starting and ending between',
            items: [
                {
                    xtype: 'datefield',
                    id: 'portfolioItemsStart',
                    itemId: 'portfolioItemsStart',
                    fieldLabel: 'Start',
                    value: (new Lumenize.Time(NOW)).add(-3, Lumenize.Time.MONTH).getJSDate('UTC'), // 3 months ago
                    listeners: {
                        change: Ext.bind(this._onDateSelected, this)
                    }
                },
                {
                    xtype: 'datefield',
                    id: 'portfolioItemsEnd',
                    itemId: 'portfolioItemsEnd',
                    fieldLabel: 'End',
                    value: (new Lumenize.Time(NOW)).add(3, Lumenize.Time.MONTH).getJSDate('UTC'), // 3 months from now
                    listeners: {
                        change: Ext.bind(this._onDateSelected, this)
                    }
                }
            ]
        });

        this.add({
            xtype: 'fieldset',
            title: 'Sample historical throughput between',
            items: [
                {
                    xtype: 'datefield',
                    id: 'historicalThroughputStart',
                    itemId: 'historicalThroughputStart',
                    fieldLabel: 'Start',
                    maxValue: NOW,
                    value: (new Lumenize.Time(NOW)).add(-3, Lumenize.Time.MONTH).getJSDate('UTC')
                },
                {
                    xtype: 'datefield',
                    id: 'historicalThroughputEnd',
                    itemId: 'historicalThroughputEnd',
                    fieldLabel: 'End',
                    maxValue: NOW,
                    value: NOW
                }
            ]
        });

        this._onDateSelected();
    },

    _onDateSelected: function() {
        var app = this;
        var pisPromise = app.loadPortfolioItems();

        // Get all currently unaccepted stories associated with a feature
        var storiesPromise = app.getSnapshots({
            fetch: ['_ProjectHierarchy', '_ItemHierarchy'],
            findConfig: {
                "_TypeHierarchy": "HierarchicalRequirement",
                "__At": "current",
                "ScheduleState": {
                    "$lt": "Accepted"
                },
                "Feature": {
                    "$exists": true
                }
            }
        });

        var throughputPromise = app.throughputByProject();

        Deft.Promise.all([ pisPromise, storiesPromise, throughputPromise ]).then(function(result) {
            var store = result[0];
            var stories = result[1];
            var historicalThroughput = result[2];

            store.each(function(portfolioItem) {
                var objectId = portfolioItem.data.ObjectID;
                var startOn = Ext.Date.format(new Date(), "Y-m-d");
                var endBefore = Ext.Date.format(portfolioItem.data.PlannedEndDate, "Y-m-d");

                //If endBefore < startOn, we need Infinity throughput to finish on time, so those
                //features will still display as "at risk" (since we already blew the planned end date)
                var timeline = new Lumenize.Timeline({
                    startOn: startOn,
                    endBefore: endBefore,
                    granularity: Lumenize.Time.DAY
                });
                var workdaysRemaining = timeline.getAll().length;

                portfolioItem.data.Projects = {};

                //TODO - optimize later
                //Count stories remaining by project id
                _.each(stories, function(story) {
                    if (story._ItemHierarchy.indexOf(objectId) >= 0) {
                        portfolioItem.data.Projects[story.Project] = portfolioItem.data.Projects[story.Project] || { count: 0 }
                        portfolioItem.data.Projects[story.Project].count++
                    }
                });

                //Normalize story count by workdays remaining
                _.each(portfolioItem.data.Projects, function(project, projectOid) {
                    project.daysToCompletion = project.count * historicalThroughput[projectOid];
                    project.atRisk = project.daysToCompletion > workdaysRemaining;
                });

                //Determine if project is at risk (required throughput > historical throughput)
                portfolioItem.data.AtRisk = _.any(portfolioItem.data.Projects, function(project) {
                    return project.daysToCompletion > workdaysRemaining;
                });

                var piLink = Ext.dom.Query.select('a[href*=' + portfolioItem.data.ObjectID +']');

                if (portfolioItem.data.AtRisk) {
                    Ext.get(piLink[0]).addCls('atRisk');
                }

                app.getProjectNamebyIds(_.keys(portfolioItem.data.Projects)).then(function(names){
                    var table = '';
                    _.each(portfolioItem.data.Projects, function(project, projectOid) {
                        var actualThroughput = historicalThroughput[projectOid];
                        table += [
                            '<tr class="', (project.atRisk ? 'atRisk' : 'notAtRisk') ,'">',
                                '<td>', names[projectOid], '</td>',
                                '<td>', workdaysRemaining, '</td>',
                                '<td>', project.daysToCompletion.toFixed(2), '</td>',
                            '</tr>'
                        ].join('');
                    });

                    table = [
                        '<tr>',
                            '<th>Project</th>',
                            '<th>Days left</th>',
                            '<th>Days needed</th>',
                        '</tr>',
                        table
                    ].join('');
                    
                    Ext.create('Rally.ui.tooltip.ToolTip', {
                        target : Ext.get(piLink[0]),
                        html: '<table>' + table + '</table>'
                    });
                });
            });
        });
    },

    getProjectNamebyIds: function(ids) {
        var deferred = new Deft.Deferred();
        var filter;

        _.each(ids, function(id){
            var filterItem = Ext.create('Rally.data.QueryFilter', 
            {
                property: 'ObjectID',
                operator: '=',
                value: id
            });

            filter = filter ? filter.or(filterItem) : filterItem;
        });

        Ext.create('Rally.data.WsapiDataStore', {
            config: {
                autoLoad: true,
                limit: 'Infinity'
            },
            model: 'Project',
            filters: filter,
            listeners: {
                load: function(store, data, success) {
                    var names = {};
                    _.each(data, function(project){
                        names[project.data.ObjectID] = project.data.Name;
                    });
                    deferred.resolve(names);
                }
            },
            fetch: ['ObjectID,Name']
        });

        return deferred.getPromise();
    },
    
    getSnapshots: function(config) {
        var workspaceOid = this.context.getWorkspace().ObjectID;
        var deferred = new Deft.Deferred();
        Ext.create('Rally.data.lookback.SnapshotStore', _.merge({
            // TODO - account for > 20k results
            autoLoad: true,
            context: {
                workspace: '/workspace/' + workspaceOid
            },
            listeners: {
                load: function(store, data, success) {
                    deferred.resolve(_.pluck(data, 'raw'));
                }
            }
        }, config));

        return deferred.getPromise();
    },
    
    throughputByProject: function() {
        var start = Ext.Date.format(Ext.getCmp('historicalThroughputStart').getValue(), "Y-m-d");
        var end = Ext.Date.format(Ext.getCmp('historicalThroughputEnd').getValue(), "Y-m-d");

        var timeline = new Lumenize.Timeline({
            startOn: start,
            endBefore: end,
            granularity: Lumenize.Time.DAY
        });
        var workdays = timeline.getAll().length;

        //Stories transitioned from <Accepted to >=Accepted
        var forwardThroughput = this.getSnapshots({
            fetch: ['_ProjectHierarchy'],
            findConfig: {
                "_TypeHierarchy": "HierarchicalRequirement",
                "_PreviousValues.ScheduleState": {
                    "$exists": true,
                    "$lt": "Accepted"
                },
                "ScheduleState": {
                    "$gte": "Accepted"
                },
                "_ValidFrom": {
                    "$lt": end,
                    "$gte": start
                }
            }
        });

        //Stories transitioned from >=Accepted to <Accepted
        var backwardThroughput = this.getSnapshots({
            fetch: ['_ProjectHierarchy'],
            findConfig: {
                "_TypeHierarchy": "HierarchicalRequirement",
                "_PreviousValues.ScheduleState": {
                    "$exists": true,
                    "$gte": "Accepted"
                },
                "ScheduleState": {
                    "$lt": "Accepted"
                },
                "_ValidFrom": {
                    "$lt": end,
                    "$gte": start
                }
            }
        });

        //Group into lookup table by project oid
        return Deft.Promise.all([ forwardThroughput, backwardThroughput ]).then(function(results) {
            var forward = results[0];
            var backward = results[1];
            var throughput = {};
            
            // Add forward throughput
            _.each(forward, function(snapshot) {
                _.each(snapshot._ProjectHierarchy, function(projectOid) {
                    throughput[projectOid] = throughput[projectOid] || 0;
                    throughput[projectOid]++;
                });
            });

            //Subtract backward throughput
            _.each(backward, function(snapshot) {
                _.each(snapshot._ProjectHierarchy, function(projectOid) {
                    throughput[projectOid] = throughput[projectOid] || 0;
                    throughput[projectOid]--;
                });
            });

            //Normalize the throughput by workday
            return _.transform(throughput, function(result, num, key) {
                result[key] = num/workdays;
            });
        });
    },

    loadPortfolioItems: function() {
        var workspaceOid = this.context.getWorkspace().ObjectID;
        var portfolioItemsStart = Ext.Date.format(Ext.getCmp('portfolioItemsStart').getValue(), "Y-m-d");
        var portfolioItemsEnd = Ext.Date.format(Ext.getCmp('portfolioItemsEnd').getValue(), "Y-m-d");
        var deferred = new Deft.Deferred();

        this.portfolioTree = this.add({
            xtype: 'portfolioforecasttree',
            id: 'portfoliotree',
            itemId: 'portfoliotree',
            enableDragAndDrop: false,
            //@todo: parameterize PI type
            topLevelModel: workspaceOid == '41529001' ? 'portfolioitem/feature' : 'portfolioitem/epic',
            topLevelStoreConfig: {
                filters: [{
                    property: 'PlannedStartDate',
                    operator: '>',
                    value: portfolioItemsStart
                }, {
                    property: 'PlannedEndDate',
                    operator: '<',
                    value: portfolioItemsEnd
                }, {
                    property: 'DirectChildrenCount', //Only show PIs that have children
                    operator: '>',
                    value: 0
                }, {
                    property: 'PercentDoneByStoryCount', //Do not show completed PIs
                    operator: '<',
                    value: 1
                }],
                listeners: {
                    refresh: function(store) {
                        deferred.resolve(store);
                    }
                }
            }
        });

        return deferred.getPromise();
    }
});
