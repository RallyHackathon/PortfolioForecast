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
                Rally.getApp().loadPortfolioItems();
            }
       }

    ],

    launch: function() {
        //Last 3 months
        Ext.getCmp('dateFrom').setValue(new Date(2014,3,1)); //@todo configure, set dynamically
        Ext.getCmp('dateTo').setValue(new Date(2014,10,1));
        
        this.throughputByProject('2014-03', '2014-06').then(function(lookup) {
            console.log(lookup);
        });
    },
    
    getSnapshots: function(config) {
        var workspaceOid = this.context.getWorkspace().ObjectID;
        var deferred = new Deft.Deferred();
        Ext.create('Rally.data.lookback.SnapshotStore', _.merge({
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
            
            return throughput;
        });
    },

    loadPortfolioItems: function() {
        var workspaceOid = this.context.getWorkspace().ObjectID;
        this.add(
            {
             xtype: 'rallyportfoliotree',
             //@todo: parameterize PI type
             topLevelModel: workspaceOid == '41529001' ? 'portfolioitem/feature' : 'portfolioitem/epic',
             topLevelStoreConfig: {
                filters: [{
                    property: 'PlannedStartDate',
                    operator: '>',
                    value: Ext.Date.format(Ext.getCmp('dateFrom').getValue(), "Y-m-d")
                }, {
                    property: 'PlannedEndDate',
                    operator: '<',
                    value:Ext.Date.format(Ext.getCmp('dateTo').getValue(), "Y-m-d")
                }]
            }
        });
    }
});
