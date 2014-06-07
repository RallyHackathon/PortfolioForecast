var Lumenize = require('./lumenize')

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items: [
        {
            xtype: 'datepicker',
            id: 'dateFrom',
            itemId: 'dateFrom',
            //setValue: function(){ return '2014-01-01'},
            handler: function(picker, date) {
                // do something with the selected date
                //Rally.getApp().dateFrom = date;
            }
        },
        {
            xtype: 'datepicker',
            id: 'dateTo',
            itemId: 'dateTo',
            handler: function(picker, date) {
                // do something with the selected date
                //Rally.getApp().dateTo = date;
                var app = Rally.getApp();

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

                var throughputPromise = app.throughputByProject(app.getDateFrom(), app.getDateTo());

                Deft.Promise.all([ pisPromise, storiesPromise, throughputPromise ]).then(function(result) {
                    var store = result[0];
                    var stories = result[1];
                    var historicalThroughput = result[2];

                    store.each(function(portfolioItem) {
                        debugger;
                        var objectId = portfolioItem.data.ObjectID;
                        var startOn = Ext.Date.format(new Date(), "Y-m-d");
                        var endBefore = Ext.Date.format(portfolioItem.data.PlannedEndDate, "Y-m-d");

                        //TODO - what if endBefore < startOn?
                        var timeline = new Lumenize.Timeline({
                            startOn: startOn,
                            endBefore: endBefore,
                            granularity: Lumenize.Time.DAY
                        });
                        var workdaysRemaining = timeline.getAll().length;

                        portfolioItem.data.RequiredThroughputByProject = {};


                        //TODO - optimize later
                        //Count stories remaining by project id
                        _.each(stories, function(story) {
                            if (story._ItemHierarchy.indexOf(objectId) >= 0) {
                                portfolioItem.data.RequiredThroughputByProject[story.Project] = portfolioItem.data.RequiredThroughputByProject[story.Project] || 0
                                portfolioItem.data.RequiredThroughputByProject[story.Project]++
                            }
                        });

                        //Normalize story count by workdays remaining
                        portfolioItem.data.RequiredThroughputByProject = _.transform(portfolioItem.data.RequiredThroughputByProject, function(result, count, project) {
                            result[project] = count/workdaysRemaining;
                        });

                        //Determine if project is at risk (required throughput > historical throughput)
                        portfolioItem.data.AtRisk = _.any(portfolioItem.data.RequiredThroughputByProject, function(requiredThroughput, project) {
                            return requiredThroughput > historicalThroughput[project];
                        });

                        if (portfolioItem.data.AtRisk) {
                            console.log("FEATURE IS AT RISK!!!");
                            console.log(portfolioItem.data);
                        }
                    });
                });
            }
        }
    ],

    launch: function() {
        //Last 3 months
        Ext.getCmp('dateFrom').setValue(new Date(2014,3,1)); //@todo configure, set dynamically
        Ext.getCmp('dateTo').setValue(new Date(2014,10,1));
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
    
    throughputByProject: function(start, end) {
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

    getDateFrom: function() {
        return Ext.Date.format(Ext.getCmp('dateFrom').getValue(), "Y-m-d");
    },

    getDateTo: function() {
        return Ext.Date.format(Ext.getCmp('dateTo').getValue(), "Y-m-d");
    },

    loadPortfolioItems: function() {
        var workspaceOid = this.context.getWorkspace().ObjectID;
        var dateFrom = this.getDateFrom();
        var dateTo = this.getDateTo();
        var deferred = new Deft.Deferred();

        this.add(
            {
                xtype: 'rallyportfoliotree',
                id: 'portfoliotree',
                itemId: 'portfoliotree',
                //@todo: parameterize PI type
                topLevelModel: workspaceOid == '41529001' ? 'portfolioitem/feature' : 'portfolioitem/epic',
                topLevelStoreConfig: {
                filters: [{
                    property: 'PlannedStartDate',
                    operator: '>',
                    value: dateFrom
                }, {
                    property: 'PlannedEndDate',
                    operator: '<',
                    value: dateTo
                }, {
                    property: 'DirectChildrenCount', //Only show PIs that have children
                    operator: '>',
                    value: 0
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
